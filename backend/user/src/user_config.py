"""
Functionality:
- read and write user config backed by PostgreSQL
- encapsulate persistence of user properties
"""

from typing import TypedDict

from django.db import transaction
from user.models import Account, UserSettings


class UserConfigType(TypedDict, total=False):
    """describes the user configuration"""

    stylesheet: str
    page_size: int
    sort_by: str
    sort_order: str
    view_style_home: str
    view_style_channel: str
    view_style_downloads: str
    view_style_playlist: str
    vid_type_filter: str | None
    grid_items: int
    hide_watched: bool | None
    hide_watched_channel: bool | None
    hide_watched_playlist: bool | None
    file_size_unit: str
    show_ignored_only: bool
    show_subed_only: bool | None
    show_subed_only_playlists: bool | None
    show_help_text: bool


class UserConfig:
    """
    Handle settings for an individual user
    items are expected to be validated in the serializer
    """

    _DEFAULT_USER_SETTINGS = UserConfigType(
        stylesheet="dark.css",
        page_size=25,
        sort_by="published",
        sort_order="desc",
        view_style_home="grid",
        view_style_channel="list",
        view_style_downloads="list",
        view_style_playlist="grid",
        vid_type_filter=None,
        grid_items=3,
        hide_watched=False,
        hide_watched_channel=None,
        hide_watched_playlist=None,
        file_size_unit="binary",
        show_ignored_only=False,
        show_subed_only=None,
        show_subed_only_playlists=None,
        show_help_text=True,
    )

    def __init__(self, user_id: str):
        self._user_id: str = user_id
        self._config: UserConfigType = dict(self._DEFAULT_USER_SETTINGS)
        self._config = self.get_config()

    def _settings(self) -> UserSettings:
        account = Account.objects.get(pk=self._user_id)
        settings_row, _ = UserSettings.objects.get_or_create(account=account)
        return settings_row

    def get_value(self, key: str):
        """Get the given key from the users configuration
        Throws a KeyError if the requested Key is not a permitted value"""
        if key not in self._DEFAULT_USER_SETTINGS:
            raise KeyError(f"Unable to read config for unknown key '{key}'")

        return self._config.get(key)

    @transaction.atomic
    def set_value(self, key: str, value: str | bool | int):
        """Set one value without losing concurrent preference updates."""
        self._settings()
        settings_row = UserSettings.objects.select_for_update().get(
            account_id=self._user_id
        )
        settings_row.values[key] = value
        settings_row.save(update_fields=["values"])
        self._config[key] = value
        print(f"User {self._user_id} value '{key}' change: to {value}")

    @transaction.atomic
    def get_config(self) -> UserConfigType:
        """Load PostgreSQL preferences or application defaults."""
        if not self._user_id:
            raise ValueError("no user_id passed")

        self._settings()
        settings_row = UserSettings.objects.select_for_update().get(
            account_id=self._user_id
        )
        if not settings_row.values:
            settings_row.values = dict(self._DEFAULT_USER_SETTINGS)
            settings_row.save(update_fields=["values"])
        return self.sync_new_defaults(settings_row.values)

    @transaction.atomic
    def update_config(self, to_update: dict) -> None:
        """Merge preferences while holding row lock."""
        self._settings()
        settings_row = UserSettings.objects.select_for_update().get(
            account_id=self._user_id
        )
        settings_row.values.update(to_update)
        settings_row.save(update_fields=["values"])
        self._config.update(to_update)

        for key, value in to_update.items():
            print(f"User {self._user_id} value '{key}' change: to {value}")

    def sync_defaults(self):
        """set initial defaults on 404"""
        settings_row = self._settings()
        settings_row.values = dict(self._DEFAULT_USER_SETTINGS)
        settings_row.save(update_fields=["values"])
        print(f"set default config for user {self._user_id}")

    def sync_new_defaults(self, config):
        """sync new defaults"""
        for key, value in self._DEFAULT_USER_SETTINGS.items():
            if key not in config:
                self.set_value(key, value)
                config.update({key: value})

        return config
