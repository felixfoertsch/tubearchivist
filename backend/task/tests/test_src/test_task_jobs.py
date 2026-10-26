"""Focused PostgreSQL task state and enqueue contract tests."""

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.utils import timezone
from procrastinate.exceptions import JobAborted
from task.jobs import TaskContext, enqueue_task
from task.models import JobState
from task.src.task_manager import TaskManager


@pytest.mark.django_db
def test_enqueue_persists_procrastinate_id_and_pending_state():
    with patch("task.jobs.execute.configure") as configure:
        configure.return_value.defer.return_value = 42
        assert enqueue_task("version_check") == 42
    configure.assert_called_once_with(lock=None)
    configure.return_value.defer.assert_called_once_with(
        task_name="version_check",
        args=[],
        kwargs={},
    )
    assert TaskManager().get_task("42")["status"] == "PENDING"


@pytest.mark.django_db
def test_enqueue_serializes_singleton_task_execution():
    with patch("task.jobs.execute.configure") as configure:
        configure.return_value.defer.return_value = 43
        enqueue_task("download_pending")
    configure.assert_called_once_with(lock="task:download_pending")
    configure.return_value.defer.assert_called_once_with(
        task_name="download_pending",
        args=[],
        kwargs={},
    )


@pytest.mark.django_db
def test_progress_is_persisted_and_abort_raises_job_aborted():
    state = JobState.objects.create(
        task_id="7", name="version_check", status="STARTED"
    )
    context = type("Context", (), {"should_abort": lambda self: True})()
    task = TaskContext("version_check", "7", context)
    with patch("common.src.runtime.RuntimeStore.set_message"):
        task.send_progress(["working"], progress=0.5)
    state.refresh_from_db()
    assert state.progress["messages"] == ["working"]
    with pytest.raises(JobAborted):
        task.is_stopped()


@pytest.mark.django_db
def test_stopped_returning_task_stays_revoked():
    from task.jobs import execute

    state = JobState.objects.create(
        task_id="stop-running", name="version_check", status="STARTED"
    )
    context = SimpleNamespace(
        job=SimpleNamespace(id="stop-running"), should_abort=lambda: False
    )
    tasks = __import__("task.tasks", fromlist=["TASKS"])
    original = tasks.TASKS["version_check"]

    def ordinary_task(task):
        JobState.objects.filter(task_id=task.request.id).update(
            command="STOP", status="REVOKED"
        )
        return "finished loop"

    tasks.TASKS["version_check"] = ordinary_task
    try:
        with patch("task.src.notify.Notifications.send"):
            execute.func(context, "version_check", [], {})
        state.refresh_from_db()
        assert state.status == "REVOKED"
        assert state.result == "Task stopped"
    finally:
        tasks.TASKS["version_check"] = original


@pytest.mark.django_db
def test_terminal_task_state_has_completion_time():
    state = JobState.objects.create(task_id="9", name="version_check")
    state.set_status("SUCCESS", result="done")
    assert state.date_done <= timezone.now()
    assert state.result == "done"
