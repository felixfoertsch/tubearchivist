"""base classes to inherit from"""

import logging
import re

from common.src.env_settings import EnvironmentSettings
from common.src.index_generic import Pagination
from django.conf import settings
from rest_framework import exceptions, permissions
from rest_framework.authentication import (
    SessionAuthentication,
    TokenAuthentication,
)
from rest_framework.views import APIView

DRF_LOGGER = logging.getLogger("django.security.csrf")


def check_admin(user):
    """check for admin permission for restricted views"""
    return user.is_staff or user.groups.filter(name="admin").exists()


class AdminOnly(permissions.BasePermission):
    """allow only admin"""

    def has_permission(self, request, view):
        return check_admin(request.user)


class AdminWriteOnly(permissions.BasePermission):
    """allow only admin writes"""

    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return permissions.IsAuthenticated().has_permission(request, view)
        return check_admin(request.user)


class CsrfLoggingSessionAuthentication(SessionAuthentication):
    """Log DRF CSRF failures when Django debug mode is enabled."""

    def enforce_csrf(self, request):
        try:
            super().enforce_csrf(request)
        except exceptions.PermissionDenied as err:
            if settings.DEBUG:
                DRF_LOGGER.warning(
                    "CSRF validation failed for path %r: %r. "
                    "Set TA_HOST to browser origin; trusted origins: %r",
                    request.path,
                    str(err.detail),
                    settings.CSRF_TRUSTED_ORIGINS,
                )
            raise


class ApiBaseView(APIView):
    """base view to inherit from"""

    authentication_classes = [
        CsrfLoggingSessionAuthentication,
        TokenAuthentication,
    ]
    permission_classes = [permissions.IsAuthenticated]

    def __init__(self):
        super().__init__()
        self.response = {}
        self.data = {}
        self.status_code = False
        self.context = False
        self.pagination_handler = False

    def get_queryset(self):
        """Return queryset declared by concrete API view."""
        return (
            self._queryset
            if hasattr(self, "_queryset")
            else self.model.objects.all()
        )

    def get_document(self, document_id, progress_match=None):
        """Load one ORM object and convert it to existing wire shape."""
        obj = self.get_queryset().filter(pk=document_id).first()
        self.response = self.to_data(obj) if obj is not None else {}
        if self.response:
            from common.src.search_processor import SearchProcess

            self.response = SearchProcess(
                self.response, progress_match
            ).process()
            self.response.pop("_index", None)
            self.response.pop("_score", None)
            if "stats" in self.response:
                self.response["stats"].setdefault("average_rating", 0)
        self.status_code = 200 if obj is not None else 404

    def initiate_pagination(self, request):
        self.pagination_handler = Pagination(request)

    def get_document_list(self, request, pagination=True, progress_match=None):
        """Paginate queryset; pagination window remains capped at 10,000."""
        queryset = self.get_queryset()
        if pagination:
            self.initiate_pagination(request)
            page = self.pagination_handler.pagination
            total = min(queryset.count(), 10000)
            self.pagination_handler.validate(total)
            start = page["page_from"]
            end = start + page["page_size"]
            queryset = queryset.__getitem__(slice(start, end))
        objects = list(queryset)
        from common.src.search_processor import SearchProcess

        self.response["data"] = SearchProcess(
            [self.to_data(obj) for obj in objects], progress_match
        ).process()
        for item in self.response["data"]:
            item.pop("_index", None)
            item.pop("_score", None)
            if "stats" in item:
                item["stats"].setdefault("average_rating", 0)
        self.status_code = 200 if self.response["data"] else 404
        if pagination:
            self.response["paginate"] = self.pagination_handler.pagination

    def get_aggs(self):
        raise NotImplementedError(
            "Use a native database aggregation in this view"
        )


class StaticAuthBaseView(APIView):
    """baseview for static files, handle DISABLE_STATIC_AUTH"""

    http_method_names = [method.lower() for method in permissions.SAFE_METHODS]
    permission_classes = (
        [permissions.AllowAny]
        if EnvironmentSettings.DISABLE_STATIC_AUTH
        else [permissions.IsAuthenticated]
    )
    authentication_classes = (
        []
        if EnvironmentSettings.DISABLE_STATIC_AUTH
        else [CsrfLoggingSessionAuthentication, TokenAuthentication]
    )
    CACHE_CONTROL = (
        "public, max-age=3600"
        if EnvironmentSettings.DISABLE_STATIC_AUTH
        else "private, max-age=3600"
    )
    CHANNEL_ID_REG = re.compile(r"UC[A-Za-z0-9_-]{22}")
    CHANNEL_ART_REG = re.compile(r"banner|thumb|tvart")
    VIDEO_ID_REG = re.compile(r"[A-Za-z0-9_-]{11}")
    PLAYLIST_ID_REG = re.compile(r"(?:LL|WL|[A-Za-z0-9_-]{13,48})")
    SUBTITLE_LANG_REG = re.compile(r"[A-Za-z0-9_-]{2,10}")

    def validate_channel_id(self, channel_id: str) -> None:
        if not self.CHANNEL_ID_REG.fullmatch(channel_id):
            raise ValueError("invalid channel ID")

    def validate_channel_art_type(self, channel_art: str) -> None:
        if not self.CHANNEL_ART_REG.fullmatch(channel_art):
            raise ValueError("invalid channel art type")

    def validate_video_id(self, video_id: str) -> None:
        if not self.VIDEO_ID_REG.fullmatch(video_id):
            raise ValueError("invalid video ID")

    def validate_playlist_id(self, playlist_id: str) -> None:
        if not self.PLAYLIST_ID_REG.fullmatch(playlist_id):
            raise ValueError("invalid playlist ID")

    def validate_subtitle_lang(self, lang: str) -> None:
        if not self.SUBTITLE_LANG_REG.fullmatch(lang):
            raise ValueError("invalid subtitle lang")
