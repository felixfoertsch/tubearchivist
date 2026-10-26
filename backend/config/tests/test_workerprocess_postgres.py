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


def start_worker(marker, setup=""):
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
        [
            sys.executable,
            "-c",
            WORKER.replace(
                'marker = Path(os.environ["HOLD_MARKER"])',
                'marker = Path(os.environ["HOLD_MARKER"])\n' + setup,
            ),
        ],
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


DOWNLOAD_SETUP = """
from common.src.runtime import RuntimeQueue
from common.src.env_settings import EnvironmentSettings
from download.src import yt_dlp_handler as handler
from video.src import index
from download.src.thumbnails import ThumbManager
# Short test lease; real claims, heartbeat, retry scheduling and fencing.
RuntimeQueue.CLAIM_SECONDS = 4
root = marker.parent
EnvironmentSettings.CACHE_DIR = str(root / "cache")
EnvironmentSettings.MEDIA_DIR = str(root / "media")
handler.DownloaderBase.CACHE_DIR = EnvironmentSettings.CACHE_DIR
handler.DownloaderBase.MEDIA_DIR = EnvironmentSettings.MEDIA_DIR
(root / "cache" / "download").mkdir(parents=True, exist_ok=True)
(root / "media").mkdir(exist_ok=True)
def download(self, youtube_id):
    target = root / "cache" / "download" / (youtube_id + ".mp4")
    with (root / "network_calls").open("a") as log:
        log.write(youtube_id + "\\n")
    if not (root / "interrupted").exists():
        target.write_bytes(b"partial")
        (root / "interrupted").touch()
        marker.touch()
        while True:
            time.sleep(0.05)
    target.write_bytes(b"complete media")
    marker.touch()
    while not marker.with_suffix(".release").exists():
        time.sleep(0.05)
    return True, None
handler.YtWrap.download = download
def extract(self, url):
    return {"id": "resume00001", "channel_id": "resume-channel",
            "title": "Resume", "thumbnail": "https://example.test/thumb",
            "upload_date": "20260101", "duration": 2}, None
handler.YtWrap.extract = extract
# Stub external network/media probes, not indexing or archive/domain work.
index.get_duration_sec = lambda path: 2
index.MediaStreamExtractor.extract_metadata = lambda self: []
ThumbManager.download_video_thumb = lambda self, url: None
original_delete = handler.delete_and_ignore
def record_delete(videos):
    with (root / "deletions").open("a") as log:
        for video in videos:
            log.write(video["youtube_id"] + "\\n")
    return original_delete(videos)
handler.delete_and_ignore = record_delete
"""


@pytest.fixture
def empty_worker_queue():
    from django.db import connection

    # Procrastinate tables are unmanaged; Django flush leaves them behind.
    def clear():
        with connection.cursor() as cursor:
            cursor.execute("TRUNCATE procrastinate_jobs CASCADE")

    clear()
    yield
    clear()


def test_killed_download_retries_after_lease_and_fences_old_owner(
    tmp_path, empty_worker_queue
):
    from appsettings.src.config import AppConfig
    from channel.models import Channel
    from common.models import QueueEntry
    from common.src.runtime import RuntimeQueue
    from download.models import Download
    from video.models import Video

    AppConfig().update_config(
        {
            "downloads": {
                "integrate_ryd": False,
                "integrate_sponsorblock": False,
                "subtitle": False,
                "comment_max": False,
                "add_metadata": False,
                "autodelete_days": 1,
            }
        }
    )
    channel = Channel.objects.create(id="resume-channel", name="Resume")
    Download.objects.create(id="resume00001", channel_id=channel.pk)
    Download.objects.create(
        id="ignored0001", channel_id=channel.pk, status="ignore"
    )
    old = Video.objects.create(
        id="obsolete001",
        channel=channel,
        watched=True,
        watched_at=1,
        media_url="resume-channel/obsolete001.mp4",
    )
    old_file = tmp_path / "media" / old.media_url
    old_file.parent.mkdir(parents=True)
    old_file.write_bytes(b"obsolete")
    queue = RuntimeQueue("download:pending")
    queue.add("resume00001")
    job_id = enqueue_task("download_pending")
    process = start_worker(tmp_path / "first", DOWNLOAD_SETUP)
    try:
        wait_for((tmp_path / "first").exists, process)
        claim = QueueEntry.objects.get(queue=queue.key, value="resume00001")
        old_owner, expiry = claim.claimed_by, claim.claimed_until
        assert ProcrastinateJob.objects.get(pk=job_id).status == "doing"
    finally:
        stop_worker(process)
    assert Download.objects.get(pk="resume00001").status == "pending"
    assert not Video.objects.filter(pk="resume00001").exists()
    assert old_file.exists()
    time.sleep(1.1)
    replacement = start_worker(tmp_path / "second", DOWNLOAD_SETUP)
    try:
        dispatch_job()
        wait_for(
            lambda: JobState.objects.get(task_id=str(job_id)).status
            == "RETRY",
            replacement,
        )
        retry = ProcrastinateJob.objects.get(pk=job_id)
        assert retry.scheduled_at >= expiry
        assert not (tmp_path / "second").exists()
        wait_for((tmp_path / "second").exists, replacement, seconds=20)
        new_claim = QueueEntry.objects.get(
            queue=queue.key, value="resume00001"
        )
        assert new_claim.claimed_by != old_owner
        queue._claims["resume00001"] = old_owner
        assert not queue.ack("resume00001")
        queue._claims["resume00001"] = old_owner
        assert not queue.release("resume00001")
        assert (
            QueueEntry.objects.get(pk=new_claim.pk).claimed_by
            == new_claim.claimed_by
        )
        (tmp_path / "second.release").touch()
        wait_for(
            lambda: JobState.objects.get(task_id=str(job_id)).status
            == "SUCCESS",
            replacement,
        )
        wait_for(
            lambda: ProcrastinateJob.objects.get(pk=job_id).status
            == "succeeded",
            replacement,
        )
        dispatch_job()
        assert ProcrastinateJob.objects.get(pk=job_id).attempts == 2
        assert Video.objects.filter(pk="resume00001").count() == 1
        archived = tmp_path / "media" / "resume-channel" / "resume00001.mp4"
        assert archived.read_bytes() == b"complete media"
        assert not Download.objects.filter(pk="resume00001").exists()
        assert Download.objects.get(pk="ignored0001").status == "ignore"
        assert Download.objects.get(pk=old.pk).status == "ignore"
        assert not old_file.exists()
        assert not Video.objects.filter(pk=old.pk).exists()
        assert (tmp_path / "deletions").read_text().splitlines() == [old.pk]
        assert (tmp_path / "network_calls").read_text().splitlines() == [
            "resume00001",
            "resume00001",
        ]
        assert not QueueEntry.objects.filter(queue=queue.key).exists()
    finally:
        stop_worker(replacement)
