"""PostgreSQL read API and aggregate contracts."""

from datetime import date, datetime
from datetime import timezone as dt_timezone

import pytest
from channel.models import Channel
from common.src.domain import download_data
from download.models import Download
from playlist.models import Playlist, PlaylistEntry
from rest_framework.test import APIClient
from stats.src.aggs import DownloadHist
from stats.src.aggs import Video as VideoStats
from user.models import Account
from video.models import Video
from video.src.query_building import QueryBuilder

pytestmark = pytest.mark.django_db


def _video(
    channel, key, title, published, views=0, streams=None, video_type="videos"
):
    return Video.objects.create(
        id=key,
        channel=channel,
        title=title,
        published=datetime.combine(
            date.fromisoformat(published), datetime.min.time(), dt_timezone.utc
        ),
        view_count=views,
        video_type=video_type,
        metadata={"streams": streams or []},
        downloaded_at=datetime(2026, 10, 26, tzinfo=dt_timezone.utc),
        media_size=100,
        duration=60,
    )


def test_video_queryset_filters_and_stream_height_matches_any_stream():
    channel = Channel.objects.create(id="api-channel", name="API Channel")
    a = _video(
        channel,
        "api-a",
        "A",
        "2024-01-01",
        2,
        [{"height": 720}, {"height": 1080}],
    )
    _video(
        channel, "api-b", "B", "2025-01-01", 10, [{"height": 480}], "shorts"
    )
    assert list(
        QueryBuilder(
            user_id=1, channel="api-channel", height=1080
        ).build_query()
    ) == [a]
    assert list(
        QueryBuilder(user_id=1, type="shorts", sort="views", order="desc")
        .build_query()
        .values_list("pk", flat=True)
    ) == ["api-b"]


def test_custom_playlist_keeps_entry_order_and_unavailable_entries():
    channel = Channel.objects.create(id="order-channel", name="Order Channel")
    first = _video(channel, "order-first", "First", "2024-01-01")
    last = _video(channel, "order-last", "Last", "2024-01-01")
    playlist = Playlist.objects.create(
        id="order-playlist", name="Ordered", playlist_type="custom"
    )
    PlaylistEntry.objects.create(
        playlist=playlist,
        video_id="not-downloaded",
        position=0,
        title="Unavailable",
    )
    PlaylistEntry.objects.create(
        playlist=playlist, video_id=last.pk, position=1, title="Last"
    )
    PlaylistEntry.objects.create(
        playlist=playlist, video_id=first.pk, position=2, title="First"
    )
    ids = list(
        QueryBuilder(user_id=1, playlist=playlist.pk)
        .build_query()
        .values_list("pk", flat=True)
    )
    assert ids == [last.pk, first.pk]
    assert [
        entry.video_id for entry in playlist.entries.order_by("position")
    ] == [
        "not-downloaded",
        last.pk,
        first.pk,
    ]


def test_native_stats_group_and_timezone_day_buckets():
    channel = Channel.objects.create(id="stats-channel", name="Stats Channel")
    _video(channel, "stats-video", "Stats", "2026-10-26")
    stats = VideoStats().process()
    assert stats["doc_count"] == 1
    assert stats["type_videos"]["doc_count"] == 1
    history = DownloadHist().process()
    assert {row["date"] for row in history} == {"2026-10-26"}
    assert history[0]["count"] == 1


def test_video_and_channel_detail_apis_present_media_urls():
    account = Account.objects.create_user("api-reader", "password")
    channel = Channel.objects.create(
        id="U" + "a" * 22,
        name="API Channel",
        metadata={"channel_thumb_url": "remote"},
    )
    video = Video.objects.create(
        id="abcdefghijk",
        channel=channel,
        title="API Video",
        published="2026-10-25T00:00:00+00:00",
        media_url="API Video.mp4",
        metadata={
            "streams": [],
            "category": [],
            "player": {"duration": 60, "average_rating": 0},
        },
    )
    client = APIClient()
    client.force_authenticate(account)
    video_response = client.get(f"/api/video/{video.pk}/")
    assert video_response.status_code == 200
    assert video_response.data["media_url"] == "/media/stream/API%20Video.mp4"
    assert (
        video_response.data["vid_thumb_url"]
        == f"/media/thumb/video/{video.pk}.jpg"
    )
    channel_response = client.get(f"/api/channel/{channel.pk}/")
    assert channel_response.status_code == 200
    assert (
        channel_response.data["channel_thumb_url"]
        == f"/media/thumb/channel/{channel.pk}/thumb.jpg"
    )


def test_download_status_queryset_and_wire_representation():
    Download.objects.create(
        id="queued-id",
        channel_id="channel",
        title="Queue entry",
        status="pending",
        video_type="videos",
    )
    Download.objects.create(
        id="ignored-id",
        channel_id="channel",
        title="Ignored entry",
        status="ignore",
        video_type="shorts",
    )
    assert list(
        Download.objects.filter(status="pending").values_list("pk", flat=True)
    ) == ["queued-id"]
    assert (
        download_data(Download.objects.get(pk="ignored-id"))["status"]
        == "ignore"
    )
