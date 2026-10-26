"""Native PostgreSQL playlist query building contracts."""

import pytest
from channel.models import Channel
from playlist.models import Playlist
from playlist.src.query_building import QueryBuilder

pytestmark = pytest.mark.django_db


def test_queryset_filters_and_ordering():
    channel = Channel.objects.create(
        id="playlist-query-channel", name="Channel"
    )
    regular = Playlist.objects.create(
        id="playlist-regular",
        channel_id=channel.pk,
        name="Regular",
        playlist_type="regular",
        subscribed=True,
    )
    Playlist.objects.create(
        id="playlist-custom",
        channel_id=channel.pk,
        name="Custom",
        playlist_type="custom",
        subscribed=False,
    )
    result = QueryBuilder(
        channel="playlist-query-channel", subscribed=True, type="regular"
    ).build_data()
    assert list(result.values_list("pk", flat=True)) == [regular.pk]
    assert list(
        QueryBuilder(type="custom").build_data().values_list("pk", flat=True)
    ) == ["playlist-custom"]
    assert list(
        QueryBuilder()
        .build_data()
        .order_by("name")
        .values_list("name", flat=True)
    ) == ["Custom", "Regular"]


def test_invalid_playlist_type_rejected():
    with pytest.raises(ValueError):
        QueryBuilder(type="invalid").build_data()
