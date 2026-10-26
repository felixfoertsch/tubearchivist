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
        patch(f"{MODULE}.Download.objects.filter") as download,
    ):
        channel.return_value.get_overwrites.return_value = {
            "auto_ignore_filter": pattern
        }
        result = downloader._auto_ignore({**VIDEO, "title": title})
        assert result is expected
        channel.assert_called_once_with(VIDEO["channel_id"])
        channel.return_value.get_from_db.assert_called_once_with()
        if expected:
            download.assert_called_once_with(pk=VIDEO["youtube_id"])
            download.return_value.update.assert_called_once_with(
                status="ignore"
            )
        else:
            download.assert_not_called()


def test_filter_is_reloaded_and_missing_channels_are_allowed():
    downloader = object.__new__(VideoDownloader)
    downloader._notify = Mock()
    with (
        patch(f"{MODULE}.YoutubeChannel") as channel,
        patch(f"{MODULE}.Download.objects.filter"),
    ):
        channel.return_value.get_overwrites.side_effect = [
            {},
            {"auto_ignore_filter": TITLE},
        ]
        assert not downloader._auto_ignore(VIDEO)
        assert downloader._auto_ignore(VIDEO)
        channel.return_value.json_data = False
        assert not downloader._auto_ignore(VIDEO)
        assert channel.return_value.get_from_db.call_count == 3


@pytest.mark.parametrize("auto_only", [False, True])
@pytest.mark.parametrize("add_metadata", [False, True, "simple"])
def test_ignored_video_is_skipped_without_failing_queue(
    auto_only, add_metadata
):
    downloader = object.__new__(VideoDownloader)
    downloader.config = {"downloads": {"add_metadata": add_metadata}}
    downloader.task = Mock()
    downloader.task.is_stopped.return_value = False
    downloader.task.request.id = "test-task"
    downloader.task.request.retries = 0
    downloader._reset_auto = Mock()
    downloader.pending_queue = Mock()
    downloader.pending_queue.keepalive.return_value.__enter__ = Mock()
    downloader.pending_queue.keepalive.return_value.__exit__ = Mock(
        return_value=False
    )
    downloader._notify = Mock()
    downloader._dl_single_vid = Mock(return_value=True)
    downloader.move_to_archive = Mock()
    downloader._delete_from_pending = Mock()
    regular = {**VIDEO, "youtube_id": "regular-id", "channel_id": "other-id"}
    downloader._get_next = Mock(side_effect=[VIDEO, regular, False])

    with (
        patch(f"{MODULE}.YoutubeChannel") as channel,
        patch(f"{MODULE}.Download.objects.filter") as download,
        patch(f"{MODULE}.index_new_video") as index,
        patch(f"{MODULE}.YoutubeVideo") as video,
        patch(f"{MODULE}.RuntimeQueue"),
        patch(f"{MODULE}.DownloadPostProcess") as postprocess,
        patch("download.src.rolling_window.reconcile_windows"),
    ):
        channel.return_value.get_overwrites.side_effect = [
            {"auto_ignore_filter": TITLE},
            {},
        ]
        assert downloader.run_queue(auto_only=auto_only) == (1, 0)
        assert downloader.pending_queue.ack.call_count == 2
        download.assert_called_once_with(pk=VIDEO["youtube_id"])
        download.return_value.update.assert_called_once_with(status="ignore")
        postprocess.return_value.run.assert_called_once_with()
        downloader._dl_single_vid.assert_called_once_with(
            "regular-id", "other-id"
        )
        downloader._delete_from_pending.assert_called_once_with("regular-id")
        downloader.move_to_archive.assert_called_once_with(index.return_value)
        if add_metadata == "simple":
            video.assert_called_once_with("regular-id")
            assert video.return_value.json_data is index.return_value
            video.return_value.embed_metadata.assert_called_once_with(
                from_download=True
            )
        else:
            video.assert_not_called()


@pytest.mark.parametrize("stopped,success", [(True, False), (False, False)])
def test_failed_or_stopped_download_releases_after_keepalive(stopped, success):
    downloader = object.__new__(VideoDownloader)
    downloader.config = {"downloads": {"add_metadata": False}}
    downloader.task = Mock()
    downloader.task.is_stopped.return_value = stopped
    downloader.task.request.id = "test-task"
    downloader.task.request.retries = 0
    downloader.pending_queue = Mock()
    state = {"inside": False}

    class Keepalive:
        def __enter__(self):
            state["inside"] = True

        def __exit__(self, *_):
            state["inside"] = False

    downloader.pending_queue.keepalive.return_value = Keepalive()
    downloader._get_next = Mock(return_value=VIDEO)
    downloader._auto_ignore = Mock(return_value=False)
    downloader._dl_single_vid = Mock(return_value=success)
    downloader._notify = Mock()
    downloader._reset_auto = Mock()

    def release(value):
        assert not state["inside"]
        assert value == VIDEO["youtube_id"]

    downloader.pending_queue.release.side_effect = release
    with patch(f"{MODULE}.DownloadPostProcess") as postprocess:
        result = downloader.run_queue()

    assert result == (0, int(not stopped))
    downloader.pending_queue.release.assert_called_once_with(
        VIDEO["youtube_id"]
    )
    downloader.pending_queue.ack.assert_not_called()
    postprocess.return_value.run.assert_not_called()


def test_progress_notifications_name_active_video():
    downloader = object.__new__(VideoDownloader)
    downloader.task = Mock()
    downloader.task.is_stopped.return_value = False
    downloader.task.request.id = "test-task"
    downloader.task.request.retries = 0
    downloader.active_lease = None
    downloader._notify(VIDEO, "Validate download format")
    assert downloader.task.send_progress.call_args.kwargs["youtube_id"] == (
        "podcast-id"
    )
    downloader._progress_hook(
        {
            "info_dict": {"id": "hook-id", "title": "T"},
            "_total_bytes_str": "1MiB",
            "_percent_str": "5%",
            "_speed_str": "1MiB/s",
            "_eta_str": "1s",
        }
    )
    assert downloader.task.send_progress.call_args.kwargs["youtube_id"] == (
        "hook-id"
    )
