"""Operator capabilities never grant database/credential administration."""

from copy import deepcopy

import pytest
from appsettings.src.config import AppConfig
from rest_framework.test import APIClient
from task.src.task_manager import TaskManager
from user.models import Account

pytestmark = pytest.mark.django_db


@pytest.fixture
def operator(settings):
    settings.TA_APP_OPERATOR_ACCESS = True
    user = Account.objects.create_user("operator", "password")
    client = APIClient()
    client.force_login(user)
    return client


@pytest.mark.parametrize(
    "path",
    [
        "/api/appsettings/backup/",
        "/api/appsettings/token/",
        "/api/appsettings/cookie/",
        "/api/task/by-name/run_backup/",
        "/api/task/by-name/restore_backup/",
        "/api/task/schedule/run_backup/",
        "/api/task/schedule/restore_backup/",
        "/api/task/notification/",
    ],
)
def test_operator_cannot_access_security_routes(operator, path):
    assert operator.get(path).status_code == 403
    assert operator.post(path, {}, format="json").status_code == 403


def test_task_id_and_aggregate_boundaries(operator, monkeypatch):
    backup = {"name": "run_backup", "task_id": "backup-id"}
    normal = {
        "name": "download_pending",
        "task_id": "normal-id",
        "status": "PENDING",
        "result": None,
        "traceback": None,
        "date_done": "",
    }
    monkeypatch.setattr(
        TaskManager, "get_all_results", lambda _: [backup, normal]
    )
    monkeypatch.setattr(TaskManager, "get_task", lambda _, task_id: backup)
    assert operator.get("/api/task/by-id/backup-id/").status_code == 403
    assert (
        operator.post(
            "/api/task/by-id/backup-id/", {"command": "stop"}
        ).status_code
        == 403
    )
    response = operator.get("/api/task/by-name/")
    assert response.status_code == 200
    assert all(item["name"] != "run_backup" for item in response.data)


def test_account_capabilities_not_staff(operator):
    response = operator.get("/api/user/account/")
    assert response.data["can_manage_app"] is True
    assert response.data["can_administer"] is False
    assert response.data["is_staff"] is False
    assert operator.get("/admin/").status_code == 302


@pytest.mark.parametrize("enabled", [True, False])
@pytest.mark.parametrize("stored", [True, False])
def test_operator_cannot_toggle_stored_cookie(operator, enabled, stored):
    config = AppConfig()
    config.update_config({"downloads": {"cookie_import": stored}})
    before = deepcopy(AppConfig().config)
    response = operator.post(
        "/api/appsettings/config/",
        {
            "downloads": {"cookie_import": enabled, "sleep_interval": 42},
            "subscriptions": {"channel_size": 17},
        },
        format="json",
    )
    assert response.status_code == 403
    assert AppConfig().config == before


def test_operator_can_update_normal_config(operator):
    AppConfig()
    response = operator.post(
        "/api/appsettings/config/",
        {"downloads": {"sleep_interval": 42}},
        format="json",
    )
    assert response.status_code == 200
    assert AppConfig().config["downloads"]["sleep_interval"] == 42


@pytest.mark.parametrize("enabled", [True, False])
def test_admin_can_toggle_stored_cookie(settings, enabled):
    user = Account.objects.create_user("administrator", "password")
    user.is_staff = True
    user.save()
    client = APIClient()
    client.force_login(user)
    AppConfig().update_config({"downloads": {"cookie_import": not enabled}})
    response = client.post(
        "/api/appsettings/config/",
        {"downloads": {"cookie_import": enabled}},
        format="json",
    )
    assert response.status_code == 200
    assert AppConfig().config["downloads"]["cookie_import"] is enabled


def test_anonymous_never_gains_operator_access(settings):
    settings.TA_APP_OPERATOR_ACCESS = True
    client = APIClient()
    assert client.post("/api/download/", {}, format="json").status_code == 403
    assert client.get("/api/task/by-name/").status_code == 403
