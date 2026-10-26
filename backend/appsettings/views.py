"""all app settings API views"""

from appsettings.serializers import (
    AppConfigSerializer,
    BackupFileSerializer,
    CookieUpdateSerializer,
    CookieValidationSerializer,
    ManualImportConfig,
    RescanFileSystemConfig,
    TokenResponseSerializer,
)
from appsettings.src.backup import PostgreSQLBackup
from appsettings.src.config import AppConfig
from common.serializers import (
    AsyncTaskResponseSerializer,
    ErrorResponseSerializer,
)
from common.src.runtime import RuntimeStore
from common.views_base import (
    AdminOnly,
    ApiBaseView,
    AppOperatorOnly,
    AppOperatorWriteOnly,
    check_admin,
)
from django.http import FileResponse
from download.src.yt_dlp_base import CookieHandler
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework.authtoken.models import Token
from rest_framework.response import Response
from task.src.task_manager import TaskCommand


class BackupApiListView(ApiBaseView):
    """resolves to /api/appsettings/backup/
    GET: returns list of available zip backups
    POST: take zip backup now
    """

    permission_classes = [AdminOnly]
    task_name = "run_backup"

    @staticmethod
    @extend_schema(
        responses={
            200: OpenApiResponse(BackupFileSerializer(many=True)),
        },
    )
    def get(request):
        """get list of available backup files"""
        # pylint: disable=unused-argument
        backup_files = PostgreSQLBackup().get_all_backup_files()
        serializer = BackupFileSerializer(backup_files, many=True)
        return Response(serializer.data)

    @extend_schema(
        responses={
            200: OpenApiResponse(AsyncTaskResponseSerializer()),
        },
    )
    def post(self, request):
        """start new backup file task"""
        # pylint: disable=unused-argument
        response = TaskCommand().start(self.task_name)
        message = {
            "message": "backup task started",
            "task_id": response["task_id"],
        }
        serializer = AsyncTaskResponseSerializer(message)

        return Response(serializer.data)


class BackupApiView(ApiBaseView):
    """resolves to /api/appsettings/backup/<filename>/
    GET: return a single backup
    POST: restore backup
    DELETE: delete backup
    """

    permission_classes = [AdminOnly]
    task_name = "restore_backup"

    @staticmethod
    @extend_schema(
        responses={
            200: OpenApiResponse(BackupFileSerializer()),
            404: OpenApiResponse(
                ErrorResponseSerializer(), description="file not found"
            ),
        }
    )
    def get(request, filename):
        """get single backup"""
        # pylint: disable=unused-argument
        backup_file = PostgreSQLBackup().build_backup_file_data(filename)
        if not backup_file:
            error = ErrorResponseSerializer({"error": "file not found"})
            return Response(error.data, status=404)

        serializer = BackupFileSerializer(backup_file)

        return Response(serializer.data)

    @extend_schema(
        responses={
            200: OpenApiResponse(AsyncTaskResponseSerializer()),
            404: OpenApiResponse(
                ErrorResponseSerializer(), description="file not found"
            ),
        }
    )
    def post(self, request, filename):
        """Restore requires quiesced offline maintenance, never a web task."""
        return Response(
            {
                "error": (
                    "Online restore is disabled. Stop app and workers, "
                    "then run python manage.py ta_restore_backup <filename> "
                    "--quiesced --target-database <database>. "
                    "See backend/docs/postgresql-backup.md."
                )
            },
            status=409,
        )

    @staticmethod
    @extend_schema(
        responses={
            204: OpenApiResponse(description="file deleted"),
            404: OpenApiResponse(
                ErrorResponseSerializer(), description="file not found"
            ),
        }
    )
    def delete(request, filename):
        """delete backup file"""
        # pylint: disable=unused-argument

        backup_file = PostgreSQLBackup().delete_file(filename)
        if not backup_file:
            error = ErrorResponseSerializer({"error": "file not found"})
            return Response(error.data, status=404)

        return Response(status=204)


class BackupDownloadView(ApiBaseView):
    """Authenticated download of native database artifacts."""

    permission_classes = [AdminOnly]

    @staticmethod
    def get(request, filename):
        info = PostgreSQLBackup().build_backup_file_data(filename)
        if not info:
            return Response({"error": "file not found"}, status=404)
        return FileResponse(
            open(info["file_path"], "rb"),
            as_attachment=True,
            filename=filename,
            content_type="application/octet-stream",
        )


class AppConfigApiView(ApiBaseView):
    """resolves to /api/appsettings/config/
    GET: return app settings
    POST: update app settings
    """

    permission_classes = [AppOperatorWriteOnly]

    @staticmethod
    def _serialize_config(config, user):
        if not check_admin(user):
            config = {
                **config,
                "downloads": {
                    **config["downloads"],
                    "pot_provider_url": None,
                },
            }
        return AppConfigSerializer(config).data

    @staticmethod
    @extend_schema(
        responses={
            200: OpenApiResponse(AppConfigSerializer()),
        }
    )
    def get(request):
        """get app config"""
        response = AppConfigApiView._serialize_config(
            AppConfig().config, request.user
        )
        return Response(response)

    @staticmethod
    @extend_schema(
        request=AppConfigSerializer(),
        responses={
            200: OpenApiResponse(AppConfigSerializer()),
            400: OpenApiResponse(
                ErrorResponseSerializer(), description="Bad request"
            ),
        },
    )
    def post(request):
        """update config values, allows partial update"""
        serializer = AppConfigSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        validated_data = serializer.validated_data
        if not check_admin(
            request.user
        ) and "pot_provider_url" in validated_data.get("downloads", {}):
            return Response(
                {"error": "Administrator access required."}, status=403
            )
        updated_config = AppConfig().update_config(validated_data)
        return Response(
            AppConfigApiView._serialize_config(updated_config, request.user)
        )


class CookieView(ApiBaseView):
    """resolves to /api/appsettings/cookie/
    GET: check if cookie is enabled
    POST: verify validity of cookie
    PUT: import cookie
    DELETE: revoke the cookie
    """

    permission_classes = [AdminOnly]

    @extend_schema(
        responses={
            200: OpenApiResponse(CookieValidationSerializer()),
        }
    )
    def get(self, request):
        """get cookie validation status"""
        # pylint: disable=unused-argument
        validation = self._get_cookie_validation()
        serializer = CookieValidationSerializer(validation)

        return Response(serializer.data)

    @extend_schema(
        responses={
            200: OpenApiResponse(CookieValidationSerializer()),
        }
    )
    def post(self, request):
        """validate cookie"""
        # pylint: disable=unused-argument
        config = AppConfig().config
        _ = CookieHandler(config).validate()
        validation = self._get_cookie_validation()
        serializer = CookieValidationSerializer(validation)

        return Response(serializer.data)

    @extend_schema(
        request=CookieUpdateSerializer(),
        responses={
            200: OpenApiResponse(CookieValidationSerializer()),
            400: OpenApiResponse(
                ErrorResponseSerializer(), description="Bad request"
            ),
        },
    )
    def put(self, request):
        """handle put request"""
        # pylint: disable=unused-argument

        serializer = CookieUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated_data = serializer.validated_data

        cookie = validated_data.get("cookie")
        if not cookie:
            message = "missing cookie key in request data"
            print(message)
            error = ErrorResponseSerializer({"error": message})
            return Response(error.data, status=400)

        config = AppConfig().config
        handler = CookieHandler(config)
        handler.set_cookie(cookie)
        validated = handler.validate()
        if not validated:
            message = "[cookie]: import failed, not valid"
            print(message)
            error = ErrorResponseSerializer({"error": message})
            handler.revoke()
            return Response(error.data, status=400)

        validation = self._get_cookie_validation()
        serializer = CookieValidationSerializer(validation)

        return Response(serializer.data)

    @extend_schema(
        responses={
            204: OpenApiResponse(description="Cookie revoked"),
        },
    )
    def delete(self, request):
        """delete the cookie"""
        config = AppConfig().config
        handler = CookieHandler(config)
        handler.revoke()
        return Response(status=204)

    @staticmethod
    def _get_cookie_validation():
        """get current cookie validation"""
        config = AppConfig().config
        validation = RuntimeStore().get_message_dict("cookie:valid")
        is_enabled = {"cookie_enabled": config["downloads"]["cookie_import"]}
        validation.update(is_enabled)

        return validation


class SnapshotApiListView(ApiBaseView):
    """Retired snapshot route; native backups have separate endpoints."""

    permission_classes = [AdminOnly]

    @staticmethod
    def get(request):
        return Response(
            {
                "supported": False,
                "error": (
                    "Snapshots are unsupported. Use /api/appsettings/backup/."
                ),
            },
            status=410,
        )

    post = get


class RescanFileSystem(ApiBaseView):
    """resolves to /api/appsettings/rescan-filesystem/
    POST: start new rescan filesystem task
    """

    permission_classes = [AppOperatorOnly]

    @staticmethod
    @extend_schema(
        request=RescanFileSystemConfig,
        responses={
            200: OpenApiResponse(AsyncTaskResponseSerializer()),
        },
    )
    def post(request):
        """start new task rescan filesystem task"""
        data_serializer = RescanFileSystemConfig(data=request.data)
        data_serializer.is_valid(raise_exception=True)
        validated_data = data_serializer.validated_data

        message = TaskCommand().start("rescan_filesystem", validated_data)
        serializer = AsyncTaskResponseSerializer(message)

        return Response(serializer.data)


class ManualImportView(ApiBaseView):
    """resolves to /api/appsettings/manual-import/
    POST: start new manual import task
    """

    permission_classes = [AppOperatorOnly]

    @staticmethod
    @extend_schema(
        request=ManualImportConfig,
        responses={
            200: OpenApiResponse(AsyncTaskResponseSerializer()),
        },
    )
    def post(request):
        """manual import"""
        data_serializer = ManualImportConfig(data=request.data)
        data_serializer.is_valid(raise_exception=True)
        validated_data = data_serializer.validated_data

        message = TaskCommand().start("manual_import", validated_data)
        serializer = AsyncTaskResponseSerializer(message)

        return Response(serializer.data)


class SnapshotApiView(ApiBaseView):
    """Fail closed for retired Elasticsearch snapshot operations."""

    permission_classes = [AdminOnly]

    @staticmethod
    def get(request, snapshot_id):
        return Response(
            {
                "error": (
                    "Legacy snapshots are unsupported. "
                    "Use PostgreSQL backups; "
                    "restore requires offline maintenance."
                )
            },
            status=410,
        )

    post = get
    delete = get


class TokenView(ApiBaseView):
    """resolves to /api/appsettings/token/
    GET: get API token
    DELETE: revoke the token
    """

    permission_classes = [AdminOnly]

    @staticmethod
    @extend_schema(
        responses={
            200: OpenApiResponse(TokenResponseSerializer()),
        }
    )
    def get(request):
        """get your API token"""
        token, _ = Token.objects.get_or_create(user=request.user)
        serializer = TokenResponseSerializer({"token": token.key})
        return Response(serializer.data)

    @staticmethod
    @extend_schema(
        responses={
            204: OpenApiResponse(description="delete token"),
        }
    )
    def delete(request):
        """delete your API token, new will get created on next get"""
        print("revoke API token")
        request.user.auth_token.delete()
        return Response(status=204)
