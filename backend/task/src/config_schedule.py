"""Persist and validate dynamic three-field TubeArchivist cron schedules."""

from django.utils import timezone
from task.models import CustomPeriodicTask


class ScheduleBuilder:
    """Build database schedules consumed by the PostgreSQL scheduler."""

    SCHEDULES = {
        "update_subscribed": "0 8 *",
        "download_pending": "0 16 *",
        "check_reindex": "0 12 *",
        "thumbnail_check": "0 17 *",
        "run_backup": "0 18 0",
        "version_check": "0 11 *",
    }

    def update_schedule(
        self, task_name: str, cron_schedule: str, schedule_conf: dict | None
    ) -> CustomPeriodicTask:
        if cron_schedule == "auto":
            cron_schedule = self.SCHEDULES[task_name]
        task, _ = CustomPeriodicTask.objects.get_or_create(
            name=task_name,
            defaults={"schedule": cron_schedule, "task_config": {}},
        )
        if cron_schedule is not None:
            task.schedule = cron_schedule
        if schedule_conf:
            task.task_config.update(schedule_conf)
        task.last_run_at = timezone.now()
        task.save()
        return task

    def get_set_task(self, task_name, schedule=False):
        task, _ = CustomPeriodicTask.objects.get_or_create(
            name=task_name,
            defaults={"schedule": "0 0 *", "task_config": {}},
        )
        if schedule:
            task.schedule = schedule
            task.last_run_at = timezone.now()
            task.save(update_fields=["schedule", "last_run_at"])
        return task

    @staticmethod
    def get_set_cron_tab(schedule: str) -> str:
        return schedule

    def set_config(
        self, task_name: str, key: str, value
    ) -> CustomPeriodicTask:
        task = CustomPeriodicTask.objects.get(name=task_name)
        task.task_config.update({key: value})
        task.save(update_fields=["task_config"])
        return task


class CrontabValidator:
    """Validate existing three-field (minute, hour, weekday) UI format."""

    CONFIG = {"check_reindex": ["days"], "run_backup": ["rotate"]}

    @staticmethod
    def validate_fields(cron_fields: list[str]) -> None:
        if len(cron_fields) != 3:
            raise ValueError("expected three cron schedule fields")

    @staticmethod
    def validate_minute(minute_field: str) -> None:
        if not minute_field.isdigit():
            raise ValueError("Invalid value for minutes. Must be an integer.")
        if not 0 <= int(minute_field) <= 59:
            raise ValueError("Invalid minutes. Must be between 0 and 59.")

    @staticmethod
    def validate_cron_tab(minute: str, hour: str, day_of_week: str) -> None:
        try:
            from croniter import croniter

            if "/" in hour or "/" in day_of_week:
                raise ValueError("step expressions are unsupported")
            croniter(f"{minute} {hour} * * {day_of_week}")
        except (ImportError, ValueError) as err:
            raise ValueError(f"invalid crontab: {err}") from err

    def validate_cron(self, cron_expression):
        if not cron_expression or cron_expression == "auto":
            return
        cron_fields = cron_expression.split()
        self.validate_fields(cron_fields)
        minute, hour, day_of_week = cron_fields
        self.validate_minute(minute)
        self.validate_cron_tab(minute, hour, day_of_week)

    def validate_config(self, task_name: str, schedule_config: dict):
        if not schedule_config:
            return
        config_keys = self.CONFIG.get(task_name)
        if not config_keys:
            raise ValueError(f"task '{task_name}' doesn't take config")
        for key, value in schedule_config.items():
            if key not in config_keys:
                raise ValueError(f"invalid config key for task '{task_name}'")
            if key == "days" and (not isinstance(value, int) or value < 1):
                raise ValueError("days must be a positive integer")
            if key == "rotate" and (not isinstance(value, int) or value < 0):
                raise ValueError("rotate must be a non-negative integer")
