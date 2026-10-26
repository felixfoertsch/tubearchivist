"""Explicit cancellation boundary until force-kill architecture is approved."""

import pytest
from rest_framework.test import APIClient
from task.models import JobState
from user.models import Account

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("status", ["PENDING", "STARTED", "RETRY"])
def test_force_kill_rejected_without_mutating_job(status):
    account = Account.objects.create_superuser("admin", "password")
    client = APIClient()
    client.force_authenticate(account)
    state = JobState.objects.create(
        task_id="123", name="download_pending", status=status
    )
    response = client.post(
        "/api/task/by-id/123/", {"command": "kill"}, format="json"
    )
    assert response.status_code == 409
    assert "cannot be forcibly killed" in response.data["error"]
    state.refresh_from_db()
    assert state.status == status
    assert state.command != "STOP"


def test_stop_persists_cooperative_command_and_requires_admin():
    account = Account.objects.create_user("reader", "password")
    client = APIClient()
    client.force_authenticate(account)
    state = JobState.objects.create(
        task_id="123", name="download_pending", status="STARTED"
    )
    url = "/api/task/by-id/123/"
    assert client.post(url, {"command": "stop"}).status_code == 403
    assert client.post(url, {"command": "kill"}).status_code == 403
    state.refresh_from_db()
    assert state.command != "STOP"
    account.is_staff = True
    account.save(update_fields=["is_staff"])
    assert client.post(url, {"command": "stop"}).status_code == 204
    state.refresh_from_db()
    assert state.command == "STOP"
    assert state.status == "STARTED"


def test_config_only_schedule_preserves_cron_and_missing_returns_404():
    account = Account.objects.create_superuser("admin", "password")
    client = APIClient()
    client.force_authenticate(account)
    from task.models import CustomPeriodicTask

    CustomPeriodicTask.objects.create(
        name="check_reindex", schedule="15 4 2", task_config={"days": 20}
    )
    response = client.post(
        "/api/task/schedule/check_reindex/",
        {"config": {"days": 30}},
        format="json",
    )
    assert response.status_code == 200
    assert response.data["schedule"] == "15 4 2"
    assert response.data["config"] == {"days": 30}
    CustomPeriodicTask.objects.create(
        name="run_backup", schedule="25 5 1", task_config={"rotate": 2}
    )
    response = client.post(
        "/api/task/schedule/run_backup/",
        {"config": {"rotate": 3}},
        format="json",
    )
    assert response.status_code == 200
    assert response.data["schedule"] == "25 5 1"
    assert response.data["config"] == {"rotate": 3}
    CustomPeriodicTask.objects.filter(name="run_backup").delete()
    assert (
        client.post(
            "/api/task/schedule/run_backup/",
            {"config": {"rotate": 4}},
            format="json",
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/task/schedule/missing/",
            {"config": {"rotate": 4}},
            format="json",
        ).status_code
        == 404
    )


def test_missing_task_cannot_be_cancelled():
    account = Account.objects.create_superuser("admin", "password")
    client = APIClient()
    client.force_authenticate(account)
    assert (
        client.post(
            "/api/task/by-id/missing/", {"command": "kill"}
        ).status_code
        == 404
    )
