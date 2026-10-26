"""Real PostgreSQL-backed Procrastinate worker lifecycle tests."""

from unittest.mock import patch

import pytest
from procrastinate.contrib.django import app
from procrastinate.retry import RetryDecision
from task.jobs import enqueue_task
from task.models import JobState


@pytest.mark.django_db(transaction=True)
def test_nested_enqueue_uses_django_transaction_inside_worker(monkeypatch):
    import task.tasks

    child_ids = []

    def parent(task):
        child_ids.append(enqueue_task("thumbnail_check"))

    monkeypatch.setitem(task.tasks.TASKS, "version_check", parent)
    monkeypatch.setitem(
        task.tasks.TASKS, "thumbnail_check", lambda task: "child"
    )
    enqueue_task("version_check")
    with patch("task.src.notify.Notifications.send"):
        drain_worker()
    assert JobState.objects.get(task_id=str(child_ids[0])).status == "SUCCESS"


@pytest.mark.django_db(transaction=True)
def test_stalled_download_retried_and_other_interrupted_work_failed():
    import asyncio

    from django.db import connection
    from procrastinate.contrib.django.models import ProcrastinateJob
    from task.jobs import recover_stalled_jobs

    download = enqueue_task("download_pending")
    other = enqueue_task("manual_import")
    # Simulate crash boundary: doing jobs whose worker no longer exists.
    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE procrastinate_jobs SET status='doing', worker_id=NULL "
            "WHERE id IN (%s, %s)",
            [download, other],
        )
    with app.replace_connector(app.connector.get_worker_connector()):

        async def recover():
            from asgiref.sync import sync_to_async
            from django.db import connections

            async with app.open_async():
                await recover_stalled_jobs()
            await sync_to_async(connections.close_all)()

        asyncio.run(recover())
    assert ProcrastinateJob.objects.get(pk=download).status == "todo"
    assert JobState.objects.get(task_id=str(download)).status == "RETRY"
    assert ProcrastinateJob.objects.get(pk=other).status == "failed"
    assert JobState.objects.get(task_id=str(other)).status == "FAILURE"


@pytest.mark.django_db(transaction=True)
def test_retry_exhaustion_is_terminal_in_both_stores(monkeypatch):
    import task.tasks
    from django.db import connection
    from procrastinate.contrib.django.models import ProcrastinateJob
    from procrastinate.exceptions import JobRetry

    def retrying(task):
        raise JobRetry(RetryDecision(retry_in={"seconds": 60}))

    monkeypatch.setitem(task.tasks.TASKS, "version_check", retrying)
    queued = enqueue_task("version_check")
    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE procrastinate_jobs SET attempts=3 WHERE id=%s", [queued]
        )
    with patch("task.src.notify.Notifications.send"):
        drain_worker()
    assert ProcrastinateJob.objects.get(pk=queued).status == "failed"
    assert JobState.objects.get(task_id=str(queued)).status == "FAILURE"


def drain_worker():
    from django.db import connections

    # Worker threads must close test connections before database teardown.
    previous = connections.databases["default"]["CONN_MAX_AGE"]
    connections.databases["default"]["CONN_MAX_AGE"] = 0
    try:
        with app.replace_connector(app.connector.get_worker_connector()):
            app.run_worker(wait=False, queues=["default"])
    finally:
        connections.databases["default"]["CONN_MAX_AGE"] = previous


@pytest.mark.django_db(transaction=True)
def test_postgres_worker_drains_allowlisted_task_and_honors_queued_stop():
    task_name = "version_check"
    with patch("task.src.notify.Notifications.send"):
        queued = enqueue_task(task_name)
    state = JobState.objects.get(task_id=str(queued))
    state.command = "STOP"
    state.save(update_fields=["command"])
    assert state.status == "PENDING"
    drain_worker()
    state.refresh_from_db()
    assert state.status == "REVOKED"
    assert state.result == "Task stopped before execution"


@pytest.mark.django_db(transaction=True)
def test_postgres_worker_stops_running_loop_and_preserves_revoked_state(
    monkeypatch,
):
    import task.tasks

    task_name = "version_check"
    queued = enqueue_task(task_name)
    state = JobState.objects.get(task_id=str(queued))

    def stopping_task(task):
        JobState.objects.filter(task_id=task.request.id).update(command="STOP")
        task.is_stopped()
        return "ignored result"

    monkeypatch.setitem(task.tasks.TASKS, task_name, stopping_task)
    with patch("task.src.notify.Notifications.send"):
        drain_worker()
    state.refresh_from_db()
    assert state.status == "REVOKED"
    assert state.result == "Task stopped"


@pytest.mark.django_db(transaction=True)
def test_postgres_worker_retries_job_with_requested_delay(monkeypatch):
    import task.jobs
    import task.tasks

    task_name = "version_check"
    queued = enqueue_task(task_name)
    state = JobState.objects.get(task_id=str(queued))

    def retrying_task(task):
        from procrastinate.exceptions import JobRetry

        raise JobRetry(RetryDecision(retry_in={"seconds": 60}))

    monkeypatch.setitem(task.tasks.TASKS, task_name, retrying_task)
    with patch("task.src.notify.Notifications.send"):
        drain_worker()
    state.refresh_from_db()
    assert state.status == "RETRY"
    from procrastinate.contrib.django.models import ProcrastinateJob

    job = ProcrastinateJob.objects.get(pk=queued)
    assert job.status == "todo"
    assert job.scheduled_at is not None


@pytest.mark.django_db(transaction=True)
def test_postgres_worker_runs_task_and_records_terminal_state(monkeypatch):
    import task.jobs
    import task.tasks

    task_name = "version_check"
    monkeypatch.setitem(
        task.tasks.TASKS, task_name, lambda task: "worker drained"
    )
    task.jobs.app.perform_import_paths()
    task_id = enqueue_task(task_name)
    state = JobState.objects.get(task_id=str(task_id))

    with patch("task.src.notify.Notifications.send"):
        drain_worker()
    state.refresh_from_db()
    assert state.status == "SUCCESS"
    assert state.result == "worker drained"
