"""serializer for account model"""

# pylint: disable=abstract-method

from common.src.helper import get_stylesheets
from common.views_base import can_manage_app, check_admin
from rest_framework import serializers
from user.models import Account
from video.src.constants import OrderEnum, SortEnum, VideoTypeEnum


class AccountSerializer(serializers.ModelSerializer):
    """serialize account"""

    can_manage_app = serializers.SerializerMethodField()
    can_administer = serializers.SerializerMethodField()

    def get_can_manage_app(self, obj):
        return can_manage_app(obj)

    def get_can_administer(self, obj):
        return check_admin(obj)

    class Meta:
        model = Account
        fields = (
            "id",
            "name",
            "is_superuser",
            "is_staff",
            "groups",
            "user_permissions",
            "last_login",
            "can_manage_app",
            "can_administer",
        )


class UserMeConfigSerializer(serializers.Serializer):
    """serialize user me config"""

    stylesheet = serializers.ChoiceField(choices=get_stylesheets())
    page_size = serializers.IntegerField()
    sort_by = serializers.ChoiceField(choices=SortEnum.names())
    sort_order = serializers.ChoiceField(choices=OrderEnum.values())
    view_style_home = serializers.ChoiceField(
        choices=["grid", "list", "table"]
    )
    view_style_channel = serializers.ChoiceField(
        choices=["grid", "list", "table"]
    )
    view_style_downloads = serializers.ChoiceField(choices=["grid", "list"])
    view_style_playlist = serializers.ChoiceField(
        choices=["grid", "list", "table"]
    )
    vid_type_filter = serializers.ChoiceField(
        choices=VideoTypeEnum.values_known(), allow_null=True
    )
    grid_items = serializers.IntegerField(max_value=7, min_value=3)
    hide_watched = serializers.BooleanField(allow_null=True)
    hide_watched_channel = serializers.BooleanField(allow_null=True)
    hide_watched_playlist = serializers.BooleanField(allow_null=True)
    file_size_unit = serializers.ChoiceField(choices=["binary", "metric"])
    show_ignored_only = serializers.BooleanField()
    show_subed_only = serializers.BooleanField(allow_null=True)
    show_subed_only_playlists = serializers.BooleanField(allow_null=True)
    show_help_text = serializers.BooleanField()


class LoginSerializer(serializers.Serializer):
    """serialize login"""

    username = serializers.CharField()
    password = serializers.CharField()
    remember_me = serializers.ChoiceField(choices=["on", "off"], default="off")
