"""Review regressions for retention boundaries."""

from unittest.mock import Mock, patch

import pytest
from common.src.es_connect import IndexPaginate
from download.src.queue import PendingList
from download.src.rolling_window import RollingWindow
from download.src.yt_dlp_handler import DownloadPostProcess, VideoDownloader

MODULE = "download.src.rolling_window"


def test_global_policy_real_http_transport_has_no_body():
    rolling = RollingWindow("c", {})
    with patch(
        "common.src.es_connect.EnvironmentSettings.ES_URL",
        "http://example.invalid",
    ), patch(
        "common.src.es_connect.EnvironmentSettings.ES_USER", "test"
    ), patch(
        "common.src.es_connect.EnvironmentSettings.ES_PASS", "test"
    ), patch(
        "common.src.es_connect.requests.get"
    ) as request:
        request.return_value.status_code = 200
        request.return_value.json.return_value = {
            "_source": {"subscriptions": {"channel_size": 0}}
        }
        assert rolling.effective_depth({}) == 0
        assert request.call_count == 1
        args, kwargs = request.call_args
        assert args[0] == (
            "http://example.invalid/ta_config/_doc/appsettings"
            "?_source_includes=subscriptions.channel_size"
        )
        assert "json" not in kwargs
        assert "data" not in kwargs


def test_global_policy_get_uses_document_query_projection_without_body():
    rolling = RollingWindow("c", {})
    with patch(f"{MODULE}.ElasticWrap") as elastic:
        elastic.return_value.get.return_value = (
            {"_source": {"subscriptions": {"channel_size": 0}}},
            200,
        )
        assert rolling.effective_depth({}) == 0
        elastic.assert_called_once_with(
            "ta_config/_doc/appsettings"
            "?_source_includes=subscriptions.channel_size"
        )
        elastic.return_value.get.assert_called_once_with(print_error=False)


def test_global_policy_refreshes_after_construction_and_during_discovery():
    rolling = RollingWindow("c", {"subscriptions": {"channel_size": 50}})
    channel = {"_source": {"channel_overwrites": {"rolling_window_size": 2}}}
    with patch(f"{MODULE}.ElasticWrap") as elastic:
        elastic.return_value.get.side_effect = [
            (channel, 200),
            ({"_source": {"subscriptions": {"channel_size": 0}}}, 200),
        ]
        assert not rolling.enabled(rolling.settings())
    rolling.ignored = Mock(return_value=set())
    with patch(f"{MODULE}.ElasticWrap") as elastic, patch.object(
        rolling, "discover", return_value=[{"id": "v"}]
    ), patch(f"{MODULE}.YoutubeVideo") as delete:
        elastic.return_value.get.side_effect = [
            (channel, 200),
            ({"_source": {"subscriptions": {"channel_size": 50}}}, 200),
            (channel, 200),
            ({"_source": {"subscriptions": {"channel_size": 0}}}, 200),
        ]
        rolling.reconcile()
        delete.assert_not_called()
    with patch(f"{MODULE}.ElasticWrap") as elastic:
        elastic.return_value.get.return_value = (
            {
                "_source": {
                    "channel_overwrites": {
                        "rolling_window_size": 2,
                        "subscriptions_channel_size": 5,
                    }
                }
            },
            200,
        )
        assert rolling.enabled(rolling.settings())
        assert elastic.return_value.get.call_count == 1


def test_global_disable_during_admission_refuses_cached_targets():
    rolling = RollingWindow("c", {"subscriptions": {"channel_size": 50}})
    rolling.ignored = Mock(return_value=set())
    channel = {"_source": {"channel_overwrites": {"rolling_window_size": 2}}}
    with patch(f"{MODULE}.ElasticWrap") as elastic, patch.object(
        rolling, "discover", return_value=[{"id": "v"}]
    ):
        elastic.return_value.get.side_effect = [
            (channel, 200),
            ({"_source": {"subscriptions": {"channel_size": 50}}}, 200),
            (channel, 200),
            ({"_source": {"subscriptions": {"channel_size": 0}}}, 200),
        ]
        with pytest.raises(ValueError, match="settings changed"):
            rolling.targets()
        assert rolling.cached is None


def test_pending_arrival_between_evictions_stops_prune():
    rolling = RollingWindow("c", {})
    rolling.settings = Mock(
        return_value={
            "rolling_window_size": 1,
            "subscriptions_channel_size": 50,
        }
    )
    rolling.ignored = Mock(return_value=set())
    rolling.discover = Mock(return_value=[{"id": "new"}])
    archived = [
        {"youtube_id": i, "media_url": i + ".mp4"} for i in ["new", "a", "b"]
    ]
    with patch(f"{MODULE}.IndexPaginate") as index, patch(
        f"{MODULE}.os.path.isfile", return_value=True
    ), patch(f"{MODULE}.YoutubeVideo") as delete:
        index.return_value.get_results.side_effect = [
            archived,
            [],
            archived,
            [],
            archived,
            [{"youtube_id": "new"}],
        ]
        rolling.reconcile()
        delete.assert_called_once_with("a")


def test_confirmed_new_channel_admitted_but_lookup_failure_not_bypassed():
    downloader = object.__new__(VideoDownloader)
    downloader.config = {}
    downloader.task = None
    downloader._handle_error = Mock()
    data = {"youtube_id": "v", "channel_id": "new", "vid_type": "videos"}
    with patch(f"{MODULE}.ElasticWrap") as elastic:
        elastic.return_value.get.return_value = ({"found": False}, 404)
        assert downloader._rolling_admit(data)
        elastic.return_value.get.return_value = ({"error": "unavailable"}, 503)
        assert not downloader._rolling_admit(data)
        downloader._handle_error.assert_called_once()


def test_new_channel_manual_video_downloads_through_queue():
    downloader = object.__new__(VideoDownloader)
    downloader.config = {"downloads": {"add_metadata": False}}
    downloader.task = Mock()
    downloader.task.is_stopped.return_value = False
    downloader._get_next = Mock(
        side_effect=[
            {"youtube_id": "v", "channel_id": "new", "vid_type": "videos"},
            False,
        ]
    )
    downloader._auto_ignore = Mock(return_value=False)
    downloader._notify = Mock()
    downloader._reset_auto = Mock()
    downloader._dl_single_vid = Mock(return_value=True)
    downloader.move_to_archive = Mock()
    downloader._delete_from_pending = Mock()
    with patch(f"{MODULE}.ElasticWrap") as elastic, patch(
        f"{MODULE}.reconcile_windows"
    ), patch("download.src.yt_dlp_handler.index_new_video"), patch(
        "download.src.yt_dlp_handler.RedisQueue"
    ), patch(
        "download.src.yt_dlp_handler.DownloadPostProcess"
    ):
        elastic.return_value.get.return_value = ({"found": False}, 404)
        assert downloader.run_queue() == (1, 0)
        downloader._dl_single_vid.assert_called_once_with("v", "new")
        downloader.move_to_archive.assert_called_once()


def test_disabled_regular_tab_keeps_shorts_and_never_prunes():
    from download.src.subscriptions import ChannelSubscription

    scanner = object.__new__(ChannelSubscription)
    scanner.config = {
        "subscriptions": {"channel_size": 0, "shorts_channel_size": 5}
    }
    urls = scanner._process_channel_urls(
        [
            {
                "channel_id": "c",
                "channel_tabs": ["videos", "shorts"],
                "channel_overwrites": {"rolling_window_size": 30},
            }
        ]
    )
    assert [str(url["vid_type"]) for url in urls] == ["shorts"]
    rolling = RollingWindow("c", scanner.config)
    rolling.settings = Mock(
        return_value={
            "rolling_window_size": 30,
            "subscriptions_channel_size": 0,
        }
    )
    with patch(f"{MODULE}.YtWrap") as extract, patch(
        f"{MODULE}.YoutubeVideo"
    ) as delete:
        assert rolling.discover() == []
        rolling.reconcile()
        extract.assert_not_called()
        delete.assert_not_called()


def test_larger_n_admits_previously_evicted_upload():
    pending = object.__new__(PendingList)
    pending.channel_overwrites = {
        "c": {"rolling_window_size": 2, "subscriptions_channel_size": 50}
    }
    pending.rolling_targets = {}
    pending.admission_status = "pending"
    pending.all_channels = ["c"]
    pending.config = {}
    pending.task = None
    with patch.object(
        pending, "_extract_thumb", return_value="thumb"
    ), patch.object(
        pending, "_extract_vid_type", return_value="videos"
    ), patch(
        f"{MODULE}.RollingWindow.discover",
        return_value=[{"id": "new"}, {"id": "old"}],
    ):
        admitted = pending._parse_entry(
            "old",
            {
                "id": "old",
                "title": "old",
                "channel_id": "c",
                "channel": "C",
                "timestamp": 100,
            },
        )
        assert admitted["youtube_id"] == "old"


def test_full_scan_reused_without_assuming_server_order():
    rolling = RollingWindow("c", {})
    rolling.settings = Mock(
        return_value={
            "rolling_window_size": 2,
            "subscriptions_channel_size": 50,
        }
    )
    rolling.ignored = Mock(return_value=set())
    entries = [
        {
            "id": str(i),
            "title": str(i),
            "channel_id": "c",
            "timestamp": 100 - i,
        }
        for i in range(30)
    ]
    with patch(f"{MODULE}.YtWrap") as wrapper:
        wrapper.return_value.extract.side_effect = [
            ({"entries": list(reversed(entries))}, None),
            ValueError("old unavailable"),
        ]
        for _ in range(30):
            assert [v["id"] for v in rolling.targets()] == ["0", "1"]
        assert wrapper.return_value.extract.call_count == 1
        obs = wrapper.call_args.args[0]
        assert "playlist_items" not in obs
        assert obs["extractor_args"]["youtube"]["raise_incomplete_data"] == [
            "true"
        ]


def test_batch_reuses_discovery_and_invalidates_changed_policy():
    rolling = RollingWindow("c", {})
    rolling.settings = Mock(
        return_value={
            "rolling_window_size": 30,
            "subscriptions_channel_size": 50,
        }
    )
    rolling.ignored = Mock(return_value=set())
    rolling.discover = Mock(return_value=[{"id": "v"}])
    for _ in range(30):
        assert rolling.targets() == [{"id": "v"}]
    assert rolling.discover.call_count == 1
    rolling.settings.return_value = {
        "rolling_window_size": 31,
        "subscriptions_channel_size": 50,
    }
    rolling.targets()
    assert rolling.discover.call_count == 2


def test_removed_target_stops_multi_item_prune():
    rolling = RollingWindow("c", {})
    rolling.settings = Mock(
        return_value={
            "rolling_window_size": 1,
            "subscriptions_channel_size": 50,
        }
    )
    rolling.ignored = Mock(return_value=set())
    rolling.discover = Mock(return_value=[{"id": "new"}])
    archived = [
        {"youtube_id": i, "media_url": i + ".mp4"}
        for i in ["new", "old1", "old2"]
    ]
    with patch(f"{MODULE}.IndexPaginate") as index, patch(
        f"{MODULE}.os.path.isfile", return_value=True
    ), patch(f"{MODULE}.YoutubeVideo") as video:
        index.return_value.get_results.side_effect = [
            archived,
            [],
            archived,
            [],
            archived[1:],
            [],
        ]
        rolling.reconcile()
        video.assert_called_once_with("old1")


@pytest.mark.parametrize(
    "response,status",
    [({"id": "p", "_shards": {"failed": 1}}, 200), ({"error": "bad"}, 503)],
)
def test_partial_pit_refused(response, status):
    with patch("common.src.es_connect.ElasticWrap") as elastic:
        elastic.return_value.post.return_value = response, status
        with pytest.raises(ValueError, match="Incomplete index PIT"):
            IndexPaginate("ta_video", {}, strict=True).get_results()


@pytest.mark.parametrize(
    "failure", [{"timed_out": True}, {"_shards": {"failed": 1}}]
)
def test_later_page_failure_refused_and_pit_closed(failure):
    with patch("common.src.es_connect.ElasticWrap") as elastic:
        elastic.return_value.post.return_value = {"id": "p"}, 200
        elastic.return_value.get.side_effect = [
            ({"hits": {"hits": [{"_source": {}, "sort": [1]}]}}, 200),
            ({"hits": {"hits": []}, **failure}, 200),
        ]
        with pytest.raises(ValueError, match="Incomplete index search"):
            IndexPaginate("ta_video", {}, strict=True).get_results()
        elastic.return_value.delete.assert_called_once()


def test_transient_manual_admission_surfaces_retryable_failure():
    pending = object.__new__(PendingList)
    pending.channel_overwrites = {
        "c": {"rolling_window_size": 2, "subscriptions_channel_size": 50}
    }
    pending.rolling_targets = {}
    pending.admission_status = "pending"
    pending.all_channels = ["c"]
    pending.config = {}
    pending.task = None
    with patch.object(
        pending, "_extract_thumb", return_value="thumb"
    ), patch.object(
        pending, "_extract_vid_type", return_value="videos"
    ), patch(
        f"{MODULE}.RollingWindow.discover", side_effect=ValueError("network")
    ):
        with pytest.raises(ValueError, match="retry request"):
            pending._parse_entry(
                "v",
                {
                    "id": "v",
                    "title": "v",
                    "channel_id": "c",
                    "channel": "C",
                    "timestamp": 100,
                },
            )
        assert pending.rolling_failed


def test_age_cleanup_rechecks_ownership_and_ignores_only_deleted():
    videos = [
        {"youtube_id": i, "vid_type": "videos", "channel": {"channel_id": "c"}}
        for i in ["a", "b"]
    ]
    with patch("download.src.yt_dlp_handler.IndexPaginate") as index, patch(
        f"{MODULE}.owns_video", side_effect=[False, True]
    ), patch("download.src.yt_dlp_handler.YoutubeVideo") as video, patch(
        "download.src.yt_dlp_handler.PendingList"
    ) as pending:
        index.return_value.get_results.return_value = videos
        postprocess = object.__new__(DownloadPostProcess)
        postprocess.config = {}
        postprocess._auto_delete_watched({})
        video.assert_called_once_with("a")
        assert [v["url"] for v in pending.call_args.kwargs["youtube_ids"]] == [
            "a"
        ]
