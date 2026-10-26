"""Dynamic schedule due-dispatch integration tests."""

from datetime import datetime, timezone
from unittest.mock import Mock, patch
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone as django_timezone
from task.models import CustomPeriodicTask, JobState
from task.src.schedule import dispatch_schedules


def configured_task(job_id):
    from task.jobs import execute

    configured = execute.configure(schedule_at=django_timezone.now())
    configured.defer = Mock(return_value=job_id)
    return execute, configured


@pytest.mark.django_db
def test_dispatch_enqueues_due_job_once_and_cleans_expired_runtime_values():
    schedule = CustomPeriodicTask.objects.create(
        name="version_check",
        schedule="0 11 *",
        task_config={},
        last_run_at=None,
    )
    timestamp = int(
        datetime(2025, 1, 6, 11, 0, tzinfo=timezone.utc).timestamp()
    )
    task, configured = configured_task(71)
    with patch("procrastinate.contrib.django.app.perform_import_paths"), patch(
        "procrastinate.contrib.django.app.tasks", {"task.execute": task}
    ), patch("task.jobs.execute.configure", return_value=configured), patch(
        "common.src.runtime.RuntimeStore.cleanup_expired"
    ) as cleanup:
        dispatch_schedules(timestamp)
        dispatch_schedules(timestamp)
    assert cleanup.call_count == 2
    cleanup.assert_called_with(limit=1000)
    configured.defer.assert_called_once_with(
        task_name="version_check",
        args=[],
        kwargs={},
    )
    schedule.refresh_from_db()
    assert schedule.last_run_at == datetime(
        2025, 1, 6, 11, 0, tzinfo=timezone.utc
    )
    assert JobState.objects.get(task_id="71").status == "PENDING"


@pytest.mark.django_db
def test_schedule_cron_uses_configured_timezone_across_dst(monkeypatch):
    from common.src.env_settings import EnvironmentSettings

    monkeypatch.setattr(EnvironmentSettings, "TZ", "Europe/Berlin")
    timestamps = (
        (
            int(datetime(2025, 3, 30, 1, 0, tzinfo=timezone.utc).timestamp()),
            "spring",
        ),
        (
            int(datetime(2025, 10, 26, 2, 0, tzinfo=timezone.utc).timestamp()),
            "fall",
        ),
    )
    for index, (timestamp, case) in enumerate(timestamps):
        job_id = f"dst-{case}-{index}"
        schedule = CustomPeriodicTask.objects.create(
            name=f"version_check_{index}",
            schedule="0 3 *",
            task_config={},
            last_run_at=None,
        )
        task, configured = configured_task(job_id)
        with patch(
            "procrastinate.contrib.django.app.perform_import_paths"
        ), patch(
            "procrastinate.contrib.django.app.tasks", {"task.execute": task}
        ), patch(
            "task.jobs.execute.configure", return_value=configured
        ):
            dispatch_schedules(timestamp)
        configured.defer.assert_called_once_with(
            task_name=schedule.name,
            args=[],
            kwargs={},
        )
        schedule.refresh_from_db()
        assert schedule.last_run_at == datetime.fromtimestamp(
            timestamp, timezone.utc
        ).astimezone(ZoneInfo("Europe/Berlin")).replace(
            second=0, microsecond=0
        )
        assert JobState.objects.get(task_id=str(job_id)).status == "PENDING"
        schedule.delete()
