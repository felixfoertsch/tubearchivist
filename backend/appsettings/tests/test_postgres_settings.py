"""PostgreSQL-backed application settings and maintenance contracts."""

import os

import django
import pytest

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from appsettings.models import ApplicationSettings  # noqa: E402
from appsettings.src.config import AppConfig  # noqa: E402
from appsettings.src.filesystem import Scanner  # noqa: E402
from appsettings.src.reindex import (  # noqa: E402
    ReindexManual,
    ReindexPopulate,
)
from channel.models import Channel  # noqa: E402
from playlist.models import Playlist, PlaylistEntry  # noqa: E402
from task.models import NotificationURL  # noqa: E402
from task.src.notify import Notifications, get_all_notifications  # noqa: E402
from user.models import Account, UserSettings  # noqa: E402
from user.src.user_config import UserConfig  # noqa: E402
from video.models import Video  # noqa: E402


@pytest.mark.django_db(transaction=True)
def test_application_config_defaults_update_and_reload():
    ApplicationSettings.objects.all().delete()
    config = AppConfig()
    assert config.config == AppConfig.CONFIG_DEFAULTS
    assert (
        ApplicationSettings.objects.get(pk=1).sections
        == AppConfig.CONFIG_DEFAULTS
    )

    config.update_config({"subscriptions": {"channel_size": 12}})
    assert AppConfig().config["subscriptions"]["channel_size"] == 12
    assert AppConfig().config["subscriptions"]["playlist_size"] == 50
    stale = AppConfig()
    AppConfig().update_config({"subscriptions": {"channel_size": 17}})
    stale.update_config({"downloads": {"limit_speed": 100}})
    assert AppConfig().config["subscriptions"]["channel_size"] == 17
    assert AppConfig().config["downloads"]["limit_speed"] == 100


@pytest.mark.django_db(transaction=True)
def test_user_settings_default_and_updates_persist():
    UserSettings.objects.all().delete()
    account = Account.objects.create_user(
        name="settings-test", password="secret"
    )
    config = UserConfig(str(account.pk))
    assert config.get_value("page_size") == 25
    config.set_value("page_size", 40)
    config.update_config({"stylesheet": "light.css"})
    config = UserConfig(str(account.pk))
    assert config.get_value("page_size") == 40
    assert config.get_value("stylesheet") == "light.css"
    assert UserSettings.objects.get(account=account).values["page_size"] == 40
    stale = UserConfig(str(account.pk))
    UserConfig(str(account.pk)).set_value("page_size", 50)
    stale.update_config({"stylesheet": "dark.css"})
    assert UserConfig(str(account.pk)).get_value("page_size") == 50


@pytest.mark.django_db(transaction=True)
def test_notifications_unique_add_list_and_delete():
    NotificationURL.objects.filter(task_name="manual_import").delete()
    notices = Notifications("manual_import")
    notices.add_url("mailto:test@example.org")
    notices.add_url("mailto:test@example.org")
    notices.add_url("slack://token/channel")
    assert notices.get_urls() == [
        "mailto:test@example.org",
        "slack://token/channel",
    ]
    assert get_all_notifications()["manual_import"]["title"]
    notices.remove_url("mailto:test@example.org")
    assert notices.get_urls() == ["slack://token/channel"]
    notices.remove_task()
    assert notices.get_urls() == []


@pytest.mark.django_db(transaction=True)
def test_filesystem_and_reindex_queries_use_domain_relations(monkeypatch):
    PlaylistEntry.objects.all().delete()
    Video.objects.all().delete()
    Playlist.objects.all().delete()
    Channel.objects.all().delete()
    channel = Channel.objects.create(id="UC" + "a" * 22)
    video = Video.objects.create(
        id="abcdefghijk", channel=channel, active=True, last_refresh=1
    )
    playlist = Playlist.objects.create(id="PL" + "a" * 20)
    PlaylistEntry.objects.create(
        playlist=playlist, video_id=video.pk, position=0
    )

    scanner = Scanner()
    assert scanner._get_indexed() == {(video.pk, "")}

    manual = ReindexManual(extract_videos=True)
    assert manual._get_channel_videos(channel.pk) == [video.pk]
    assert manual._get_playlist_videos(playlist.pk) == [video.pk]

    populate = ReindexPopulate()
    populate.now = 10
    populate.interval = 0
    assert populate._get_total_hits(populate.REINDEX_CONFIG["video"]) == 1
    assert populate._get_outdated_ids(
        populate.REINDEX_CONFIG["video"], 10
    ) == [video.pk]
