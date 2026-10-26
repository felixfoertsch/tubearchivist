"""Exercise live worker concurrency and abrupt process death on PostgreSQL."""

import os
import signal
import subprocess
import sys
import time

import pytest
from django.conf import settings
from procrastinate.contrib.django.models import ProcrastinateJob
from task.jobs import enqueue_task
from task.models import CustomPeriodicTask, JobState

pytestmark = pytest.mark.django_db(transaction=True)


WORKER = """
import django, os, time
from pathlib import Path
django.setup()
import task.tasks
from procrastinate.contrib.django import app
from task.jobs import recover_stalled_jobs
from task.src.schedule import dispatch_schedules
from asgiref.sync import sync_to_async
marker = Path(os.environ["HOLD_MARKER"])
def held(task):
    marker.write_text("started")
    while not marker.with_suffix(".release").exists():
        time.sleep(0.05)
    return "released"
task.tasks.TASKS["manual_import"] = held
@app.task(name="review.dispatch")
async def dispatch():
    await recover_stalled_jobs()
    await sync_to_async(dispatch_schedules)(int(time.time()))
with app.replace_connector(app.connector.get_worker_connector()):
    app.run_worker(wait=True, concurrency=4, stalled_worker_timeout=1)
"""


def start_worker(marker):
    database = settings.DATABASES["default"]
    env = os.environ | {
        "DJANGO_SETTINGS_MODULE": "config.settings",
        "POSTGRES_DB": database["NAME"],
        "POSTGRES_HOST": database["HOST"],
        "POSTGRES_PORT": str(database["PORT"]),
        "POSTGRES_USER": database["USER"],
        "POSTGRES_PASSWORD": database["PASSWORD"],
        "HOLD_MARKER": str(marker),
        "PYTHONPATH": str(settings.BASE_DIR),
    }
    return subprocess.Popen(
        [sys.executable, "-c", WORKER],
        cwd=settings.BASE_DIR,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )


def wait_for(predicate, process, seconds=15):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        if process.poll() is not None:
            pytest.fail(process.stderr.read().decode())
        time.sleep(0.05)
    pytest.fail("Worker boundary did not complete before deadline")


def stop_worker(process):
    if process.poll() is None:
        process.send_signal(signal.SIGKILL)
    process.wait(timeout=10)
    process.stderr.close()


def start_command():
    database = settings.DATABASES["default"]
    env = os.environ | {
        "DJANGO_SETTINGS_MODULE": "config.settings",
        "POSTGRES_DB": database["NAME"],
        "POSTGRES_HOST": database["HOST"],
        "POSTGRES_PORT": str(database["PORT"]),
        "POSTGRES_USER": database["USER"],
        "POSTGRES_PASSWORD": database["PASSWORD"],
        "PYTHONPATH": str(settings.BASE_DIR),
    }
    return subprocess.Popen(
        [sys.executable, "manage.py", "ta_worker"],
        cwd=settings.BASE_DIR,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )


def dispatch_job():
    from procrastinate.contrib.django import app

    app.configure_task("review.dispatch").defer()


def test_management_command_starts_and_stops_exact_process():
    process = start_command()
    try:
        wait_for(lambda: process.poll() is None, process)
        time.sleep(1)
        assert process.poll() is None
    finally:
        stop_worker(process)
    assert process.poll() == -signal.SIGKILL


def test_dispatcher_enqueues_before_held_job_completes(tmp_path):
    marker = tmp_path / "hold"
    held = enqueue_task("manual_import")
    CustomPeriodicTask.objects.create(name="thumbnail_check", schedule="* * *")
    process = start_worker(marker)
    try:
        wait_for(marker.exists, process)
        dispatch_job()
        wait_for(
            lambda: JobState.objects.filter(name="thumbnail_check").exists(),
            process,
        )
        assert JobState.objects.get(task_id=str(held)).status == "STARTED"
        marker.with_suffix(".release").touch()
        wait_for(
            lambda: JobState.objects.get(task_id=str(held)).status
            == "SUCCESS",
            process,
        )
    finally:
        stop_worker(process)


def test_abrupt_worker_crash_recovered_by_running_dispatcher(tmp_path):
    marker = tmp_path / "crash"
    held = enqueue_task("manual_import")
    process = start_worker(marker)
    try:
        wait_for(marker.exists, process)
        assert ProcrastinateJob.objects.get(pk=held).status == "doing"
    finally:
        stop_worker(process)  # SIGKILL: no graceful job cleanup.
    time.sleep(1.1)  # Replacement worker's stale-heartbeat threshold.
    replacement = start_worker(tmp_path / "replacement")
    try:
        dispatch_job()
        wait_for(
            lambda: JobState.objects.get(task_id=str(held)).status
            == "FAILURE",
            replacement,
        )
        assert ProcrastinateJob.objects.get(pk=held).status == "failed"
    finally:
        stop_worker(replacement)
