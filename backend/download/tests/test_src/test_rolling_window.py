"""Bounded regular-video retention fails closed before pruning."""

from unittest.mock import Mock, patch

import pytest
from channel.serializers import ChannelOverwriteSerializer
from download.src.rolling_window import RollingWindow, window_size
from download.src.subscriptions import ChannelSubscription
from video.src.constants import VideoTypeEnum

MODULE = "download.src.rolling_window"


@pytest.mark.parametrize(
    "value", [True, False, 0, -1, 1.0, "3", [], {}, 2147483648]
)
def test_invalid_sizes(value):
    with pytest.raises(ValueError):
        window_size({"rolling_window_size": value})
    assert not ChannelOverwriteSerializer(
        data={"rolling_window_size": value}
    ).is_valid()


@pytest.mark.parametrize("value", [None, 1, 30, 2147483647])
def test_valid_sizes(value):
    assert window_size({"rolling_window_size": value}) == value
    assert ChannelOverwriteSerializer(
        data={"rolling_window_size": value}
    ).is_valid()


def test_page_size_override_only_regular_videos():
    scanner = ChannelSubscription.__new__(ChannelSubscription)
    scanner.config = {
        "subscriptions": {
            "channel_size": 50,
            "shorts_channel_size": 7,
            "live_channel_size": 8,
        }
    }
    queries = scanner._process_channel_urls(
        [
            {
                "channel_id": "c",
                "channel_tabs": ["videos", "shorts", "streams"],
                "channel_overwrites": {"rolling_window_size": 2},
            }
        ]
    )
    assert {q["vid_type"]: q["limit"] for q in queries} == {
        VideoTypeEnum.VIDEOS: 2,
        VideoTypeEnum.SHORTS: 7,
        VideoTypeEnum.STREAMS: 8,
    }


@pytest.mark.parametrize(
    "entries,pending,error,deleted",
    [
        ([{"id": "new"}], [], None, True),
        ([{"id": "new"}], [{"youtube_id": "new"}], None, False),
        ([], [], None, False),
        (None, [], ValueError("fetch failed"), False),
        (None, [], ConnectionError("offline"), False),
    ],
)
def test_reconcile(entries, pending, error, deleted):
    rolling = RollingWindow("c", {"subscriptions": {"channel_size": 50}})
    rolling.settings = Mock(return_value={"rolling_window_size": 2})
    with patch(
        f"{MODULE}.get_last_channel_videos",
        return_value=entries,
        side_effect=error,
    ) as fetch, patch(f"{MODULE}.delete_and_ignore") as remove, patch(
        f"{MODULE}.Download.objects.filter"
    ) as downloads, patch(
        f"{MODULE}.Video.objects.filter"
    ) as videos:
        downloads.return_value.exists.return_value = bool(pending)
        videos.return_value = [
            Mock(pk="new", video_type="videos"),
            Mock(pk="old", video_type="videos"),
            Mock(pk="short", video_type="shorts"),
            Mock(pk="live", video_type="streams"),
        ]
        with patch(f"{MODULE}.Video.objects.filter") as archive, patch(
            f"{MODULE}.video_data",
            side_effect=lambda obj: {
                "youtube_id": obj.pk,
                "vid_type": (
                    "videos"
                    if obj.pk in {"new", "old"}
                    else "shorts" if obj.pk == "short" else "streams"
                ),
            },
        ):
            archive.return_value = videos.return_value
            rolling.reconcile()
        fetch.assert_called_once_with(
            "c", rolling.config, limit=2, query_filter=VideoTypeEnum.VIDEOS
        )
        if deleted:
            remove.assert_called_once_with(
                [{"youtube_id": "old", "vid_type": "videos"}]
            )
            downloads.assert_called_once_with(
                channel_id="c", status="pending", video_type="videos"
            )
        else:
            remove.assert_not_called()
        rolling.settings.assert_called_once()


def test_flat_fetch_is_bounded_and_discards_error_response():
    from channel.src.remote_query import get_last_channel_videos

    with patch("channel.src.remote_query.YtWrap") as wrapper:
        wrapper.return_value.extract.return_value = (
            {"entries": [{"id": "new"}]},
            None,
        )
        assert get_last_channel_videos(
            "c", {}, limit=2, query_filter=VideoTypeEnum.VIDEOS
        ) == [{"id": "new", "vid_type": "videos"}]
        assert wrapper.call_args.args[0] == {
            "skip_download": True,
            "extract_flat": True,
            "playlist_items": ":2:1",
        }
        wrapper.return_value.extract.return_value = (
            {"entries": [{"id": "partial"}]},
            "failed",
        )
        assert (
            get_last_channel_videos(
                "c", {}, limit=2, query_filter=VideoTypeEnum.VIDEOS
            )
            == []
        )
