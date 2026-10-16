"""Strict rolling windows fail closed before destructive work."""

from unittest.mock import Mock, patch

import pytest
from channel.serializers import ChannelOverwriteSerializer
from download.src.rolling_window import RollingWindow, window_size

MODULE = "download.src.rolling_window"


@pytest.mark.parametrize(
    "value", [True, False, 0, -1, 1.0, "3", [], {}, 2147483648]
)
def test_invalid_sizes(value):
    with pytest.raises(ValueError):
        window_size({"rolling_window_size": value})
    serializer = ChannelOverwriteSerializer(
        data={"rolling_window_size": value}
    )
    assert not serializer.is_valid()


@pytest.mark.parametrize("value", [None, 1, 30, 2147483647])
def test_valid_sizes(value):
    assert window_size({"rolling_window_size": value}) == value
    serializer = ChannelOverwriteSerializer(
        data={"rolling_window_size": value}
    )
    assert serializer.is_valid(), serializer.errors


def entry(video_id, timestamp=100, **kwargs):
    return {
        "id": video_id,
        "timestamp": timestamp,
        "title": video_id,
        "channel_id": "channel",
        "live_status": "not_live",
        **kwargs,
    }


def handler():
    rolling = RollingWindow("channel", {})
    rolling.settings = Mock(
        return_value={
            "rolling_window_size": 2,
            "subscriptions_channel_size": 50,
        }
    )
    rolling.ignored = Mock(return_value=set())
    return rolling


def test_targets_sorted_filtered_and_tied():
    rolling = handler()
    rolling.settings.return_value["auto_ignore_filter"] = "skip"
    rolling.ignored.return_value = {"ignored"}
    videos = [
        entry("skip", 300),
        entry("ignored", 200),
        entry("b"),
        entry("a"),
        entry("old", 1),
    ]
    with patch(f"{MODULE}.YtWrap") as wrapper:
        wrapper.return_value.extract.return_value = ({"entries": videos}, None)
        assert [v["id"] for v in rolling.discover()] == ["a", "b"]


@pytest.mark.parametrize(
    "videos",
    [
        [],
        [None],
        [entry("a", None)],
        [entry("a", live_status="is_upcoming")],
        [entry("a", channel_id="other")],
    ],
)
def test_uncertain_discovery_refuses_cleanup(videos):
    with patch(f"{MODULE}.YtWrap") as wrapper:
        wrapper.return_value.extract.return_value = ({"entries": videos}, None)
        with pytest.raises(ValueError):
            handler().discover()


def test_cleanup_requires_all_target_media_and_current_settings():
    rolling = handler()
    rolling.discover = Mock(return_value=[entry("a"), entry("b")])
    archived = [
        {"youtube_id": i, "media_url": i + ".mp4"} for i in ["a", "b", "old"]
    ]
    with patch(f"{MODULE}.IndexPaginate") as index, patch(
        f"{MODULE}.os.path.isfile", return_value=False
    ), patch(f"{MODULE}.YoutubeVideo") as video:
        index.return_value.get_results.side_effect = [
            archived,
            [],
            archived,
            [],
        ]
        rolling.reconcile()
        video.assert_not_called()
    with patch(f"{MODULE}.IndexPaginate") as index, patch(
        f"{MODULE}.os.path.isfile", return_value=True
    ), patch(f"{MODULE}.YoutubeVideo") as video:
        index.return_value.get_results.side_effect = [
            archived,
            [],
            archived,
            [],
        ]
        rolling.reconcile()
        video.assert_called_once_with("old")
        video.return_value.delete_media_file.assert_called_once()


def test_settings_change_invalidates_cleanup():
    rolling = handler()
    rolling.discover = Mock(return_value=[entry("a"), entry("b")])
    rolling.settings.side_effect = [
        {"rolling_window_size": 2, "subscriptions_channel_size": 50},
        {"rolling_window_size": 3, "subscriptions_channel_size": 50},
    ]
    with patch(f"{MODULE}.IndexPaginate") as index, patch(
        f"{MODULE}.os.path.isfile", return_value=True
    ), patch(f"{MODULE}.YoutubeVideo") as video:
        index.return_value.get_results.return_value = [
            {"youtube_id": i, "media_url": i + ".mp4"}
            for i in ["a", "b", "old"]
        ]
        rolling.reconcile()
        video.assert_not_called()
