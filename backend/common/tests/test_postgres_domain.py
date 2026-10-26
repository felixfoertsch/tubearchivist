"""Real PostgreSQL persistence and relationship contracts."""

import pytest
from common.src.domain import (
    channel_data,
    download_data,
    playlist_data,
    save_channel,
    save_download,
    save_playlist,
    save_video,
    video_data,
)
from django.db import connection
from django.db.models.deletion import ProtectedError
from playlist.models import PlaylistEntry
from user.models import Account
from video.models import Video

pytestmark = pytest.mark.django_db


def test_native_relationships_and_representations():
    assert connection.vendor == "postgresql"
    channel = save_channel(
        {
            "channel_id": "channel",
            "channel_name": "Name",
            "channel_overwrites": {"rolling_window_size": 5},
        }
    )
    video = save_video(
        {
            "youtube_id": "video",
            "channel": channel_data(channel),
            "title": "Example",
            "published": "2026-01-02",
            "player": {"watched": True, "duration": 60},
            "tags": ["example"],
        }
    )
    playlist = save_playlist(
        {
            "playlist_id": "playlist",
            "playlist_entries": [
                {"youtube_id": "unavailable", "title": "Unavailable"},
                {"youtube_id": "video", "title": "Example"},
            ],
        }
    )
    assert "channel" not in video.metadata
    assert "playlist" not in video.metadata
    assert video_data(video)["playlist"] == ["playlist"]
    assert video_data(video)["player"]["watched"] is True
    assert [
        entry["downloaded"]
        for entry in playlist_data(playlist)["playlist_entries"]
    ] == [False, True]
    with pytest.raises(ProtectedError):
        channel.delete()
    Video.objects.filter(pk=video.pk).delete()
    assert PlaylistEntry.objects.filter(video_id="video").exists()
    assert [
        entry["downloaded"]
        for entry in playlist_data(playlist)["playlist_entries"]
    ] == [False, False]


def test_custom_playlist_null_channel_fields_round_trip_as_api_strings():
    playlist = save_playlist(
        {
            "playlist_id": "custom-null-channel",
            "playlist_name": "Custom",
            "playlist_channel": None,
            "playlist_channel_id": None,
            "playlist_type": "custom",
            "playlist_entries": [],
        }
    )
    data = playlist_data(playlist)
    assert data["playlist_channel"] == ""
    assert data["playlist_channel_id"] == ""


def test_optional_upstream_descriptions_preserve_null():
    channel = save_channel({"channel_id": "null", "channel_description": None})
    assert channel_data(channel)["channel_description"] is None
    video = save_video(
        {
            "youtube_id": "null-video",
            "channel": channel_data(channel),
            "description": None,
        }
    )
    assert video_data(video)["description"] is None
    playlist = save_playlist(
        {"playlist_id": "null-playlist", "playlist_description": None}
    )
    assert playlist_data(playlist)["playlist_description"] is None


def test_downloads_do_not_require_archive():
    queued = save_download(
        {
            "youtube_id": "not-archived",
            "channel_id": "not-archived",
            "status": "ignore",
            "title": "Ignored",
        }
    )
    assert download_data(queued)["status"] == "ignore"
    assert not Video.objects.exists()
    refreshed = save_download(
        {
            "youtube_id": "not-archived",
            "status": "pending",
            "title": "Remote refresh",
        }
    )
    assert refreshed.status == "ignore"
    assert refreshed.title == "Ignored"


def test_refresh_preserves_explicit_watched_state_and_channel_overrides():
    channel = save_channel(
        {
            "channel_id": "refresh",
            "channel_name": "Before",
            "channel_overwrites": {"rolling_window_size": 7},
        }
    )
    original = save_video(
        {
            "youtube_id": "refresh-video",
            "channel": channel_data(channel),
            "title": "Before",
            "player": {"watched": True, "watched_date": 123, "duration": 10},
        }
    )
    data = video_data(original)
    data["title"] = "After"
    refreshed = save_video(data)
    assert refreshed.watched is True
    assert refreshed.watched_at == 123
    assert refreshed.channel.overrides == {"rolling_window_size": 7}


def test_authentication_uses_postgresql():
    account = Account.objects.create_user("native", "password")
    assert Account.objects.get(pk=account.pk).check_password("password")
