"""Startup must preserve persisted configuration and runtime state."""

import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402
import pytest  # noqa: E402

django.setup()

from appsettings.models import ApplicationSettings  # noqa: E402
from common.models import RuntimeValue  # noqa: E402
from common.src.env_settings import EnvironmentSettings  # noqa: E402
from common.src.runtime import RuntimeQueue  # noqa: E402
from config.management.commands.ta_startup import Command  # noqa: E402
from task.models import CustomPeriodicTask  # noqa: E402


@pytest.mark.django_db(transaction=True)
def test_startup_is_repeat_safe_and_preserves_runtime_and_user_configuration(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(EnvironmentSettings, "CACHE_DIR", str(tmp_path))
    ApplicationSettings.objects.all().delete()
    CustomPeriodicTask.objects.all().delete()
    RuntimeValue.objects.all().delete()

    settings = ApplicationSettings.objects.create(
        pk=1,
        sections={
            "application": {
                "enable_snapshot": False,
                "enable_cast": True,
            }
        },
    )
    custom = CustomPeriodicTask.objects.create(
        name="run_backup", schedule="7 6 *", task_config={"rotate": 3}
    )
    RuntimeValue.objects.create(key="message:active", value="keep")
    queue = RuntimeQueue("download:test")
    queue.clear()
    queue.add("active-job")

    command = Command()
    command.handle()
    command.handle()

    settings.refresh_from_db()
    custom.refresh_from_db()
    assert settings.sections["application"]["enable_cast"] is True
    assert settings.sections["application"]["enable_snapshot"] is False
    assert (custom.schedule, custom.task_config) == ("7 6 *", {"rotate": 3})
    assert RuntimeValue.objects.get(key="message:active").value == "keep"
    assert queue.get_all() == ["active-job"]
    seeded = set(CustomPeriodicTask.objects.values_list("name", flat=True))
    assert seeded == {
        "run_backup",
        "check_reindex",
        "thumbnail_check",
        "version_check",
    }
    reindex = CustomPeriodicTask.objects.get(name="check_reindex")
    thumbnail = CustomPeriodicTask.objects.get(name="thumbnail_check")
    assert reindex.task_config == {"days": 90}
    assert reindex.last_run_at is not None
    assert thumbnail.last_run_at is not None
    marker = RuntimeValue.objects.get(key="STARTUP_SCHEDULES_INITIALIZED")
    assert marker.value == "1"

    CustomPeriodicTask.objects.filter(name="version_check").delete()
    CustomPeriodicTask.objects.filter(name="check_reindex").delete()
    command.handle()
    assert not CustomPeriodicTask.objects.filter(name="version_check").exists()
    assert not CustomPeriodicTask.objects.filter(name="check_reindex").exists()
