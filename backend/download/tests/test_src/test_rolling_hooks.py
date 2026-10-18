"""Rolling admission, cleanup and scan boundaries."""

from unittest.mock import patch

import pytest
from channel.src.index import YoutubeChannel
from download.src.rolling_window import owns_video
from download.src.subscriptions import ChannelSubscription


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
        assert scanner.find_missing() == 0
        reconcile.assert_called_once_with(scanner.config, None)
