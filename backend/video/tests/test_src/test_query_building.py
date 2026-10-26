"""Native PostgreSQL video query building contracts."""

from datetime import datetime, timezone

import pytest
from channel.models import Channel
from video.models import Video
from video.src.query_building import QueryBuilder

pytestmark = pytest.mark.django_db


def test_initialization():
    qb = QueryBuilder(user_id=1)
    assert qb.user_id == 1
    assert qb.request_params == {}


def test_queryset_filters_and_sorting():
    channel = Channel.objects.create(id="query-channel", name="Query Channel")
    first = Video.objects.create(
        id="query-first",
        channel=channel,
        title="First",
        video_type="videos",
        published=datetime(2024, 1, 1, tzinfo=timezone.utc),
        watched=True,
        view_count=10,
        metadata={"streams": [{"height": 720}, {"height": 1080}]},
    )
    Video.objects.create(
        id="query-second",
        channel=channel,
        title="Second",
        video_type="shorts",
        published=datetime(2025, 1, 1, tzinfo=timezone.utc),
        watched=False,
        view_count=20,
        metadata={"streams": [{"height": 480}]},
    )
    builder = QueryBuilder(
        user_id=1,
        channel="query-channel",
        watch="watched",
        type="videos",
        sort="views",
        order="desc",
    )
    assert list(builder.build_data()["queryset"]) == [first]
    assert list(
        QueryBuilder(user_id=1, type="shorts")
        .build_query()
        .values_list("pk", flat=True)
    ) == ["query-second"]
    assert list(
        QueryBuilder(user_id=1, height=720)
        .build_query()
        .values_list("pk", flat=True)
    ) == ["query-first"]
    assert list(
        QueryBuilder(user_id=1, height=1080)
        .build_query()
        .values_list("pk", flat=True)
    ) == ["query-first"]
    assert list(
        QueryBuilder(user_id=1, sort="published", order="desc")
        .build_query()
        .values_list("pk", flat=True)
    ) == ["query-second", "query-first"]
    with pytest.raises(ValueError):
        QueryBuilder(user_id=1, height="bad").build_query()


def test_stream_dimension_sort_uses_es_array_extrema_and_missing_last():
    channel = Channel.objects.create(id="stream-sort-channel", name="Channel")
    values = [
        (
            "stream-a",
            [{"width": 1920, "height": 1080}, {"width": 640, "height": 360}],
        ),
        (
            "stream-b",
            [{"width": 1280, "height": 720}, {"width": 320, "height": 240}],
        ),
        ("stream-c", [{"width": 2560, "height": 1440}]),
        ("stream-d", []),
    ]
    from rest_framework.test import APIClient
    from user.models import Account

    client = APIClient()
    client.force_authenticate(
        Account.objects.create_user("sorter", "password")
    )
    for video_id, streams in values:
        streams = [
            {
                "type": "video",
                "bitrate": 100,
                "codec": "avc1",
                "index": index,
                **stream,
            }
            for index, stream in enumerate(streams)
        ] + [{"type": "audio", "bitrate": 50, "codec": "mp4a", "index": 9}]
        Video.objects.create(
            id=video_id,
            channel=channel,
            title=video_id,
            video_type="videos",
            metadata={"streams": streams},
        )

    def sorted_ids(field, order):
        response = client.get("/api/video/", {"sort": field, "order": order})
        assert response.status_code == 200
        return [row["youtube_id"] for row in response.data["data"]]

    assert sorted_ids("width", "asc") == [
        "stream-b",
        "stream-a",
        "stream-c",
        "stream-d",
    ]
    assert sorted_ids("width", "desc") == [
        "stream-c",
        "stream-a",
        "stream-b",
        "stream-d",
    ]
    assert sorted_ids("height", "asc") == [
        "stream-b",
        "stream-a",
        "stream-c",
        "stream-d",
    ]
    assert sorted_ids("height", "desc") == [
        "stream-c",
        "stream-a",
        "stream-b",
        "stream-d",
    ]


def test_parse_watch_type_and_sort_validation():
    builder = QueryBuilder(user_id=1)
    assert builder.parse_watch("watched") == "watched"
    assert builder.parse_watch("unwatched") == "unwatched"
    assert builder.parse_type("videos") == "videos"
    with pytest.raises(ValueError):
        builder.parse_watch("invalid")
    with pytest.raises(ValueError):
        builder.parse_type("invalid")
    with pytest.raises(ValueError):
        QueryBuilder(user_id=1, sort="invalid").parse_sort()
    with pytest.raises(ValueError):
        QueryBuilder(user_id=1, sort="views", order="invalid").parse_sort()
    assert QueryBuilder(
        user_id=1, sort="views", order="desc"
    ).parse_sort() == {"sort": [{"stats.view_count": {"order": "desc"}}]}
