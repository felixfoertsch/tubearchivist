from copy import deepcopy
from unittest.mock import patch

from appsettings.views import AppConfigApiView
from common.views_base import (
    AdminOnly,
    AdminWriteOnly,
    AppOperatorOnly,
    AppOperatorTaskPermission,
    AppOperatorWriteOnly,
)
from django.contrib.auth.models import AnonymousUser
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIRequestFactory, force_authenticate
from task.views import (
    NotificationTestView,
    ScheduleNotification,
    ScheduleView,
    TaskNameListView,
)


class AppOperatorPermissionTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.user = type(
            "User", (), {"is_authenticated": True, "is_staff": False}
        )()
        self.user.groups = type(
            "Groups",
            (),
            {
                "filter": lambda *args, **kwargs: type(
                    "Query", (), {"exists": lambda self: False}
                )()
            },
        )()

    @override_settings(TA_APP_OPERATOR_ACCESS=True)
    def test_operator_can_write_content_but_not_admin_routes(self):
        request = self.factory.post("/")
        request.user = self.user
        self.assertTrue(AppOperatorWriteOnly().has_permission(request, None))
        self.assertTrue(AppOperatorOnly().has_permission(request, None))
        self.assertFalse(AdminWriteOnly().has_permission(request, None))
        self.assertFalse(AdminOnly().has_permission(request, None))

    @override_settings(TA_APP_OPERATOR_ACCESS=False)
    def test_default_policy_keeps_admin_write_restriction(self):
        request = self.factory.post("/")
        request.user = self.user
        self.assertFalse(AppOperatorWriteOnly().has_permission(request, None))
        self.assertFalse(AppOperatorOnly().has_permission(request, None))

    @override_settings(TA_APP_OPERATOR_ACCESS=True)
    def test_operator_config_hides_provider_credentials_and_rejects_updates(
        self,
    ):
        self.user.groups = type(
            "Groups",
            (),
            {
                "filter": lambda *args, **kwargs: type(
                    "Query", (), {"exists": lambda self: False}
                )()
            },
        )()
        from appsettings.src.config import AppConfig

        config = deepcopy(AppConfig.CONFIG_DEFAULTS)
        config["downloads"][
            "pot_provider_url"
        ] = "https://secret.example/?key=secret"
        with patch("appsettings.views.AppConfig") as app_config:
            app_config.return_value.config = config
            request = self.factory.get("/api/appsettings/config/")
            force_authenticate(request, user=self.user)
            response = AppConfigApiView.as_view()(request)
            self.assertIsNone(response.data["downloads"]["pot_provider_url"])

        request = self.factory.post(
            "/api/appsettings/config/",
            {
                "downloads": {
                    "pot_provider_url": "https://secret.example/?key=new"
                }
            },
            format="json",
        )
        force_authenticate(request, user=self.user)
        response = AppConfigApiView.as_view()(request)
        self.assertEqual(response.status_code, 403)

    @override_settings(TA_APP_OPERATOR_ACCESS=True)
    def test_anonymous_user_never_becomes_operator(self):
        request = self.factory.post("/")
        request.user = AnonymousUser()
        self.assertFalse(AppOperatorOnly().has_permission(request, None))

    @override_settings(TA_APP_OPERATOR_ACCESS=True)
    def test_operator_task_and_schedule_routes_exclude_backup_and_credentials(
        self,
    ):
        client_request = self.factory.post(
            "/api/task/by-name/update_subscribed/"
        )
        force_authenticate(client_request, user=self.user)
        client_request.user = self.user
        view = TaskNameListView()
        view.kwargs = {"task_name": "update_subscribed"}
        self.assertTrue(
            AppOperatorTaskPermission().has_permission(client_request, view)
        )

        backup_request = self.factory.post("/api/task/by-name/run_backup/")
        force_authenticate(backup_request, user=self.user)
        backup_request.user = self.user
        view.kwargs = {"task_name": "run_backup"}
        self.assertFalse(
            AppOperatorTaskPermission().has_permission(backup_request, view)
        )

        schedule_request = self.factory.post(
            "/api/task/schedule/update_subscribed/"
        )
        force_authenticate(schedule_request, user=self.user)
        schedule_request.user = self.user
        view = ScheduleView()
        view.kwargs = {"task_name": "update_subscribed"}
        self.assertTrue(
            AppOperatorTaskPermission().has_permission(schedule_request, view)
        )

        backup_schedule = self.factory.post("/api/task/schedule/run_backup/")
        force_authenticate(backup_schedule, user=self.user)
        backup_schedule.user = self.user
        view.kwargs = {"task_name": "run_backup"}
        self.assertFalse(
            AppOperatorTaskPermission().has_permission(backup_schedule, view)
        )

        for protected_view in (ScheduleNotification, NotificationTestView):
            self.assertEqual(protected_view.permission_classes, [AdminOnly])

    @override_settings(TA_APP_OPERATOR_ACCESS=True)
    def test_route_permissions_exercise_operator_allowed_and_admin_denied(
        self,
    ):
        request = self.factory.post("/api/task/schedule/update_subscribed/")
        force_authenticate(request, user=self.user)
        response = ScheduleView.as_view()(
            request, task_name="update_subscribed"
        )
        self.assertNotEqual(response.status_code, 403)

        request = self.factory.post("/api/task/schedule/run_backup/")
        force_authenticate(request, user=self.user)
        response = ScheduleView.as_view()(request, task_name="run_backup")
        self.assertEqual(response.status_code, 403)
