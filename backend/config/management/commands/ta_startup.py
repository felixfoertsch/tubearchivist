"""Initialize filesystem state and PostgreSQL-backed runtime metadata."""

import os
import time

from appsettings.src.config import AppConfig
from common.src.env_settings import EnvironmentSettings
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    """Run repeat-safe startup initialization after Django migrations."""

    def handle(self, *args, **options):
        self._make_folders()
        AppConfig().get_config()
        self._create_default_schedules()
        self._set_startup_time()

    @staticmethod
    def _make_folders():
        for folder in (
            "backup",
            "channels",
            "download",
            "import",
            "playlists",
            "videos",
            "ytdlp",
        ):
            path = os.path.join(EnvironmentSettings.CACHE_DIR, folder)
            os.makedirs(path, exist_ok=True)

    @staticmethod
    def _create_default_schedules():
        from common.models import RuntimeValue
        from django.db import transaction
        from django.utils import timezone
        from task.models import CustomPeriodicTask
        from task.src.config_schedule import ScheduleBuilder

        marker = "STARTUP_SCHEDULES_INITIALIZED"
        defaults = {
            "check_reindex": {
                "schedule": ScheduleBuilder.SCHEDULES["check_reindex"],
                "task_config": {"days": 90},
                "last_run_at": timezone.now(),
            },
            "thumbnail_check": {
                "schedule": ScheduleBuilder.SCHEDULES["thumbnail_check"],
                "task_config": {},
                "last_run_at": timezone.now(),
            },
            "version_check": {
                "schedule": ScheduleBuilder.SCHEDULES["version_check"],
                "task_config": {},
            },
        }
        with transaction.atomic():
            RuntimeValue.objects.get_or_create(
                key=marker, defaults={"value": ""}
            )
            state = RuntimeValue.objects.select_for_update().get(key=marker)
            if state.value:
                return
            for task_name, defaults_for_task in defaults.items():
                CustomPeriodicTask.objects.get_or_create(
                    name=task_name, defaults=defaults_for_task
                )
            state.value = "1"
            state.save(update_fields=["value"])

    @staticmethod
    def _set_startup_time():
        from common.src.runtime import RuntimeStore

        RuntimeStore().set_message(
            "STARTTIMESTAMP",
            message=str(int(time.time() // 10 * 10)),
            save=True,
        )
