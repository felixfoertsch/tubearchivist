"""Failure and refill regressions at real lifecycle seams."""

from unittest.mock import Mock, patch

import pytest
from common.src.es_connect import IndexPaginate
from download.src.rolling_window import RollingWindow
from download.src.yt_dlp_handler import VideoDownloader

MODULE = "download.src.yt_dlp_handler"
ROLLING = "download.src.rolling_window"


@pytest.mark.parametrize("success,move_error", [(False, False), (True, True)])
def test_failed_download_or_move_never_reconciles(success, move_error):
    downloader = object.__new__(VideoDownloader)
    downloader.config = {"downloads": {"add_metadata": False}}
    downloader.task = Mock()
    downloader.task.is_stopped.return_value = False
    downloader._get_next = Mock(
        side_effect=[
            {"youtube_id": "v", "channel_id": "c", "vid_type": "videos"},
            False,
        ]
    )
    downloader._auto_ignore = Mock(return_value=False)
    downloader._rolling_admit = Mock(return_value=True)
    downloader._notify = Mock()
    downloader._reset_auto = Mock()
    downloader._dl_single_vid = Mock(return_value=success)
    downloader.move_to_archive = Mock(
        side_effect=OSError("disk") if move_error else None
    )
    with patch(f"{ROLLING}.reconcile_windows") as reconcile, patch(
        f"{MODULE}.DownloadPostProcess"
    ), patch(f"{MODULE}.index_new_video"), patch(f"{MODULE}.RedisQueue"):
        if move_error:
            with pytest.raises(OSError):
                downloader.run_queue()
        else:
            assert downloader.run_queue() == (0, 1)
        reconcile.assert_not_called()


def test_archive_completion_precedes_reconciliation():
    downloader = object.__new__(VideoDownloader)
    downloader.config = {"downloads": {"add_metadata": False}}
    downloader.task = Mock()
    downloader.task.is_stopped.return_value = False
    downloader._get_next = Mock(
        side_effect=[
            {"youtube_id": "v", "channel_id": "c", "vid_type": "videos"},
            False,
        ]
    )
    downloader._auto_ignore = Mock(return_value=False)
    downloader._rolling_admit = Mock(return_value=True)
    downloader._notify = Mock()
    downloader._reset_auto = Mock()
    downloader._dl_single_vid = Mock(return_value=True)
    events = []
    downloader.move_to_archive = Mock(
        side_effect=lambda _: events.append("move")
    )
    downloader._delete_from_pending = Mock(
        side_effect=lambda _: events.append("pending")
    )
    with patch(
        f"{ROLLING}.reconcile_windows",
        side_effect=lambda *_: events.append("prune"),
    ), patch(f"{MODULE}.DownloadPostProcess"), patch(
        f"{MODULE}.index_new_video"
    ), patch(
        f"{MODULE}.RedisQueue"
    ):
        assert downloader.run_queue() == (1, 0)
    assert events == ["move", "pending", "prune"]


def test_pending_failed_target_blocks_cleanup_even_with_index_and_file():
    rolling = RollingWindow("c", {})
    rolling.settings = Mock(
        return_value={
            "rolling_window_size": 1,
            "subscriptions_channel_size": 50,
        }
    )
    rolling.ignored = Mock(return_value=set())
    rolling.discover = Mock(return_value=[{"id": "new"}])
    with patch(f"{ROLLING}.IndexPaginate") as index, patch(
        f"{ROLLING}.os.path.isfile", return_value=True
    ), patch(f"{ROLLING}.YoutubeVideo") as video:
        index.return_value.get_results.side_effect = [
            [
                {"youtube_id": "new", "media_url": "new.mp4"},
                {"youtube_id": "old", "media_url": "old.mp4"},
            ],
            [{"youtube_id": "new", "message": "failed"}],
        ]
        rolling.reconcile()
        video.assert_not_called()


@pytest.mark.parametrize(
    "response,status",
    [
        ({"hits": {"hits": []}, "timed_out": True}, 200),
        ({"hits": {"hits": []}, "_shards": {"failed": 1}}, 200),
        ({"hits": {"hits": []}}, 503),
    ],
)
def test_partial_index_results_cannot_authorize_deletion(response, status):
    index = IndexPaginate("ta_video", {}, strict=True)
    with patch("common.src.es_connect.ElasticWrap") as elastic:
        elastic.return_value.get.return_value = response, status
        with pytest.raises(ValueError, match="Incomplete index search"):
            index.run_loop()


def test_larger_window_refills_without_creating_ignores():
    rolling = RollingWindow("c", {})
    rolling.settings = Mock(
        return_value={
            "rolling_window_size": 2,
            "subscriptions_channel_size": 50,
        }
    )
    rolling.ignored = Mock(return_value=set())
    rolling.discover = Mock(return_value=[{"id": "new"}, {"id": "old"}])
    with patch(f"{ROLLING}.IndexPaginate") as index, patch(
        f"{ROLLING}.os.path.isfile", return_value=True
    ), patch(f"{ROLLING}.YoutubeVideo") as video:
        index.return_value.get_results.return_value = [
            {"youtube_id": "new", "media_url": "new.mp4"}
        ]
        rolling.reconcile()
        video.assert_not_called()
        # Missing old target remains eligible; retention never writes ignores.
        assert rolling.ignored() == set()
