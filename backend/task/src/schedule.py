"""Poll dynamic cron configuration and enqueue due tasks."""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from croniter import croniter
from django.db import transaction
from django.db.models import Q
from procrastinate.contrib.django import app
from procrastinate.contrib.django.django_connector import DjangoConnector
from procrastinate.manager import JobManager
from task.jobs import SINGLETON_TASKS
from task.models import CustomPeriodicTask


def dispatch_schedules(timestamp: int) -> None:
    """Enqueue due schedules in same transaction as their run marker."""
    from common.src.env_settings import EnvironmentSettings
    from common.src.runtime import RuntimeStore

    RuntimeStore.cleanup_expired(limit=1000)
    minute = (
        datetime.fromtimestamp(timestamp, timezone.utc)
        .astimezone(ZoneInfo(EnvironmentSettings.TZ))
        .replace(second=0, microsecond=0)
    )
    with transaction.atomic():
        schedules = (
            CustomPeriodicTask.objects.filter(
                Q(last_run_at__lt=minute) | Q(last_run_at__isnull=True)
            )
            .order_by("pk")
            .select_for_update(skip_locked=True)
        )
        for schedule in schedules:
            fields = schedule.schedule.split()
            if len(fields) != 3:
                continue
            cron = " ".join((fields[0], fields[1], "*", "*", fields[2]))
            due = (
                croniter.match(cron, minute)
                if schedule.last_run_at is None
                else croniter(
                    cron,
                    schedule.last_run_at.astimezone(
                        ZoneInfo(EnvironmentSettings.TZ)
                    ),
                ).get_next(datetime)
                <= minute
            )
            if not due:
                continue
            app.perform_import_paths()
            task = app.tasks["task.execute"]
            deferrer = task.configure(
                schedule_at=minute.astimezone(timezone.utc),
                lock=(
                    f"task:{schedule.name}"
                    if schedule.name in SINGLETON_TASKS
                    else None
                ),
            )
            deferrer.job_manager = JobManager(connector=DjangoConnector())
            job_id = deferrer.defer(
                task_name=schedule.name, args=[], kwargs={}
            )
            from task.models import JobState

            JobState.objects.create(
                task_id=str(job_id), name=schedule.name, status="PENDING"
            )
            schedule.last_run_at = minute
            schedule.save(update_fields=["last_run_at"])
