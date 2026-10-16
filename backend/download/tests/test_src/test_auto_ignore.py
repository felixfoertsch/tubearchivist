"""channel title filters in the download queue"""

from unittest.mock import Mock, patch

import pytest
from download.src.yt_dlp_handler import VideoDownloader

MODULE = "download.src.yt_dlp_handler"
TITLE = "PODCAST: The Joy of Why"
VIDEO = {
    "youtube_id": "podcast-id",
    "channel_id": "quanta-id",
    "title": f"New episode | {TITLE}",
    "vid_type": "videos",
}


@pytest.mark.parametrize(
    "pattern,title,expected",
    [
        (TITLE, VIDEO["title"], True),
        (TITLE, "A mathematics video", False),
        (f"^{TITLE}", VIDEO["title"], False),
        (f"(?i){TITLE}", TITLE.lower(), True),
        (TITLE, TITLE.lower(), False),
        ("", TITLE, False),
        (None, TITLE, False),
        ("[", TITLE, False),
        (".*", None, False),
    ],
)
def test_auto_ignore_matches(pattern, title, expected):
    downloader = object.__new__(VideoDownloader)
    downloader._notify = Mock()
    with (
        patch(f"{MODULE}.YoutubeChannel") as channel,
        patch(f"{MODULE}.PendingInteract") as pending,
    ):
        channel.return_value.get_overwrites.return_value = {
            "auto_ignore_filter": pattern
        }
        result = downloader._auto_ignore({**VIDEO, "title": title})
        assert result is expected
        channel.assert_called_once_with(VIDEO["channel_id"])
        channel.return_value.get_from_es.assert_called_once_with()
        if expected:
            pending.assert_called_once_with(
                youtube_id=VIDEO["youtube_id"], status="ignore"
            )
            pending.return_value.update_status.assert_called_once_with()
        else:
            pending.assert_not_called()


def test_filter_is_reloaded_and_missing_channels_are_allowed():
    downloader = object.__new__(VideoDownloader)
    downloader._notify = Mock()
    with (
        patch(f"{MODULE}.YoutubeChannel") as channel,
        patch(f"{MODULE}.PendingInteract"),
    ):
        channel.return_value.get_overwrites.side_effect = [
            {},
            {"auto_ignore_filter": TITLE},
        ]
        assert not downloader._auto_ignore(VIDEO)
        assert downloader._auto_ignore(VIDEO)
        channel.return_value.json_data = False
        assert not downloader._auto_ignore(VIDEO)
        assert channel.return_value.get_from_es.call_count == 3


@pytest.mark.parametrize("auto_only", [False, True])
def test_ignored_video_is_skipped_without_failing_queue(auto_only):
    downloader = object.__new__(VideoDownloader)
    downloader.task = Mock()
    downloader.task.is_stopped.return_value = False
    downloader._reset_auto = Mock()
    downloader._notify = Mock()
    downloader._dl_single_vid = Mock(return_value=True)
    downloader.move_to_archive = Mock()
    downloader._delete_from_pending = Mock()
    regular = {**VIDEO, "youtube_id": "regular-id", "channel_id": "other-id"}
    downloader._get_next = Mock(side_effect=[VIDEO, regular, False])

    with (
        patch(f"{MODULE}.YoutubeChannel") as channel,
        patch(f"{MODULE}.PendingInteract") as pending,
        patch(f"{MODULE}.index_new_video"),
        patch(f"{MODULE}.RedisQueue"),
        patch(f"{MODULE}.DownloadPostProcess"),
    ):
        channel.return_value.get_overwrites.side_effect = [
            {"auto_ignore_filter": TITLE},
            {},
        ]
        assert downloader.run_queue(auto_only=auto_only) == (1, 0)
        pending.assert_called_once_with(
            youtube_id=VIDEO["youtube_id"], status="ignore"
        )
        downloader._dl_single_vid.assert_called_once_with(
            "regular-id", "other-id"
        )
        downloader._delete_from_pending.assert_called_once_with("regular-id")
        downloader.move_to_archive.assert_called_once()
