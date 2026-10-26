"""Public playlist API contracts for creation, ordering, and navigation."""

from datetime import datetime, timezone

import pytest
from channel.models import Channel
from playlist.models import Playlist, PlaylistEntry
from rest_framework.test import APIClient
from user.models import Account
from video.models import Video

pytestmark = pytest.mark.django_db


def test_custom_create_and_add_api_accept_null_channel_and_keeps_order(
    monkeypatch,
):
    monkeypatch.setattr(
        "playlist.src.index.YoutubePlaylist.get_playlist_art",
        lambda self: None,
    )
    monkeypatch.setattr(
        "playlist.src.index.ThumbManager.download", lambda *args: None
    )
    account = Account.objects.create_superuser("playlist-writer", "password")
    channel = Channel.objects.create(id="UC" + "a" * 22, name="Channel")
    older = Video.objects.create(
        id="oldvideo001",
        channel=channel,
        title="Older published",
        metadata={"streams": []},
        published=datetime(2020, 1, 1, tzinfo=timezone.utc),
        downloaded_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
    )
    newer = Video.objects.create(
        id="newvideo001",
        channel=channel,
        title="Newer published",
        metadata={"streams": []},
        published=datetime(2025, 1, 1, tzinfo=timezone.utc),
        downloaded_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
    )
    client = APIClient()
    client.force_authenticate(account)
    created = client.post(
        "/api/playlist/custom/",
        {"playlist_name": "Saved order"},
        format="json",
    )
    assert created.status_code == 200, created.data
    playlist_id = created.data["playlist_id"]
    assert created.data["playlist_channel"] == ""
    assert created.data["playlist_channel_id"] == ""

    for video in (older, newer):
        response = client.post(
            f"/api/playlist/custom/{playlist_id}/",
            {"action": "create", "video_id": video.pk},
            format="json",
        )
        assert response.status_code == 200, response.data

    entry_ids = list(
        PlaylistEntry.objects.filter(playlist_id=playlist_id)
        .order_by("position")
        .values_list("video_id", flat=True)
    )
    assert entry_ids == [older.pk, newer.pk]
    api_list = client.get("/api/playlist/?type=custom")
    assert api_list.status_code == 200, api_list.data
    listed = next(
        row
        for row in api_list.data["data"]
        if row["playlist_id"] == playlist_id
    )
    assert [
        entry["youtube_id"] for entry in listed["playlist_entries"]
    ] == entry_ids

    nav = client.get(f"/api/video/{newer.pk}/nav/")
    assert nav.status_code == 200, nav.data
    assert nav.data[0]["playlist_previous"]["youtube_id"] == older.pk


def test_regular_playlist_video_api_and_navigation_use_entry_position():
    account = Account.objects.create_user("playlist-video-reader", "password")
    channel = Channel.objects.create(id="UC" + "c" * 22, name="Channel")
    older = Video.objects.create(
        id="oldvideo001",
        channel=channel,
        title="Older published",
        metadata={"streams": []},
        published=datetime(2020, 1, 1, tzinfo=timezone.utc),
        downloaded_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
    )
    newer = Video.objects.create(
        id="newvideo001",
        channel=channel,
        title="Newer published",
        metadata={"streams": []},
        published=datetime(2025, 1, 1, tzinfo=timezone.utc),
        downloaded_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
    )
    playlist = Playlist.objects.create(
        id="regular-entry-order", name="Regular", playlist_type="regular"
    )
    PlaylistEntry.objects.create(
        playlist=playlist, video_id=older.pk, position=0, title=older.title
    )
    PlaylistEntry.objects.create(
        playlist=playlist, video_id=newer.pk, position=1, title=newer.title
    )
    client = APIClient()
    client.force_authenticate(account)

    result = client.get(f"/api/video/?playlist={playlist.pk}")
    assert result.status_code == 200, result.data
    assert [item["youtube_id"] for item in result.data["data"]] == [
        older.pk,
        newer.pk,
    ]
    nav = client.get(f"/api/video/{newer.pk}/nav/")
    assert nav.status_code == 200, nav.data
    assert nav.data[0]["playlist_previous"]["youtube_id"] == older.pk
