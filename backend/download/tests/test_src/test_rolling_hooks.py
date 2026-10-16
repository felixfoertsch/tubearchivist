"""Rolling admission, cleanup and scan boundaries."""

from unittest.mock import Mock, patch

import pytest
from channel.src.index import YoutubeChannel
from download.src.queue import PendingList
from download.src.rolling_window import owns_video
from download.src.subscriptions import ChannelSubscription
from download.src.yt_dlp_handler import VideoDownloader


@pytest.mark.parametrize(
    "vid_type,enabled,expected",
    [
        ("videos", 2, True),
        ("videos", None, False),
        ("shorts", 2, False),
        ("streams", 2, False),
    ],
)
def test_age_cleanup_ownership(vid_type, enabled, expected):
    with patch(
        "download.src.rolling_window.RollingWindow.settings"
    ) as settings:
        settings.return_value = {
            "rolling_window_size": enabled,
            "subscriptions_channel_size": 50,
        }
        assert (
            owns_video(
                {"vid_type": vid_type, "channel": {"channel_id": "c"}}, {}
            )
            == expected
        )


def test_settings_persist_reset_without_losing_other_values():
    channel = object.__new__(YoutubeChannel)
    channel.json_data = {"channel_overwrites": {"download_format": "best"}}
    channel.set_overwrites({"rolling_window_size": 3})
    assert channel.get_overwrites()["rolling_window_size"] == 3
    channel.set_overwrites({"rolling_window_size": None})
    assert channel.get_overwrites() == {"download_format": "best"}


def test_window_overrides_scan_depth_without_enabling_other_tabs():
    scanner = object.__new__(ChannelSubscription)
    scanner.config = {"subscriptions": {"channel_size": 0}}
    queries = scanner._process_channel_urls(
        [
            {
                "channel_id": "c",
                "channel_tabs": ["videos"],
                "channel_overwrites": {"rolling_window_size": 30},
            }
        ]
    )
    assert queries == []


@pytest.mark.parametrize(
    "targets,allowed", [([{"id": "v"}], True), ([{"id": "other"}], False)]
)
def test_queued_manual_video_revalidated(targets, allowed):
    downloader = object.__new__(VideoDownloader)
    downloader.config = {}
    downloader.task = None
    downloader._delete_from_pending = Mock()
    with patch("download.src.rolling_window.RollingWindow") as rolling:
        rolling.return_value.settings.return_value = {
            "rolling_window_size": 1,
            "subscriptions_channel_size": 50,
        }
        rolling.return_value.targets.return_value = targets
        assert (
            downloader._rolling_admit(
                {"youtube_id": "v", "channel_id": "c", "vid_type": "videos"}
            )
            == allowed
        )
        assert downloader._delete_from_pending.called is not allowed


def test_manual_and_playlist_admission_reject_outside_window():
    pending = object.__new__(PendingList)
    pending.channel_overwrites = {
        "c": {"rolling_window_size": 1, "subscriptions_channel_size": 50}
    }
    pending.rolling_targets = {"c": {"new"}}
    pending.admission_status = "pending"
    pending.all_channels = ["c"]
    pending.config = {}
    pending.task = None
    with patch.object(
        pending, "_extract_thumb", return_value="thumb"
    ), patch.object(pending, "_extract_vid_type", return_value="videos"):
        assert (
            pending._parse_entry(
                "old",
                {
                    "id": "old",
                    "title": "old",
                    "channel_id": "c",
                    "channel": "C",
                    "timestamp": 100,
                },
            )
            is None
        )


def test_no_new_download_scan_still_reconciles():
    scanner = object.__new__(ChannelSubscription)
    scanner.config = {"subscriptions": {}}
    scanner.task = None
    with patch(
        "download.src.subscriptions.get_channels", return_value=[{}]
    ), patch.object(scanner, "_process_channel_urls", return_value=[]), patch(
        "download.src.subscriptions.PendingList"
    ) as pending, patch(
        "download.src.rolling_window.reconcile_windows"
    ) as reconcile:
        pending.return_value.parse_url_list.return_value = 0
        pending.return_value.rolling_failed = False
        assert scanner.find_missing() == 0
        reconcile.assert_called_once_with(scanner.config, None)
