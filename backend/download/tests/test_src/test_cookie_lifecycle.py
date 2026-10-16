"""Real yt-dlp cookie load/save lifecycle, without network or real cookies."""

from unittest.mock import Mock, patch

import pytest
from download.src.rolling_window import RollingWindow
from download.src.yt_dlp_base import YtWrap
from download.src.yt_dlp_handler import VideoDownloader
from yt_dlp.extractor.youtube import YoutubeIE, YoutubeTabIE
from yt_dlp.utils import ExtractorError

BASE = "download.src.yt_dlp_base"
CHANNEL = "UCQHX6ViZmPsWiYSFAyS0a3Q"
IDS = ["00000000000", "00000000001", "00000000002"]
COOKIE = (
    "# Netscape HTTP Cookie File\n"
    ".example.invalid\tTRUE\t/\tFALSE\t0\tsynthetic\tvalue\n"
)
CONFIG = {"downloads": {"cookie_import": True}}


@pytest.fixture
def redis():
    with patch(f"{BASE}.RedisArchivist") as store, patch(
        f"{BASE}.settings", Mock(DEBUG=False)
    ):
        store.return_value.get_message_str.return_value = COOKIE
        yield store.return_value


def detail(ie, url):
    # Force real cookie load before extraction, as network requests do.
    assert ie._downloader.cookiejar.get_cookie_header(
        "https://example.invalid"
    )
    video_id = ie._match_id(url)
    if video_id == IDS[1]:
        raise ExtractorError("Video unavailable", expected=True)
    return {
        "id": video_id,
        "title": video_id,
        "channel_id": CHANNEL,
        "timestamp": 100 - IDS.index(video_id),
        "live_status": "not_live",
        "url": "https://example.invalid/a.mp4",
        "ext": "mp4",
    }


def test_repeated_extract_loads_saves_and_refreshes_cookies(redis):
    wrapper = YtWrap({"skip_download": True}, CONFIG)
    with patch.object(YoutubeIE, "_real_extract", detail):
        for video_id in IDS + IDS[:1]:
            response, error = wrapper.extract(
                f"https://www.youtube.com/watch?v={video_id}",
                unavailable_ok=True,
            )
            assert error is None
            assert (
                response.get("id") == video_id
                or response["_type"] == "unavailable"
            )
    saved = wrapper.obs["cookiefile"].getvalue()
    assert saved.startswith("# Netscape")
    assert "\x00" not in saved
    assert "synthetic\tvalue" in saved
    redis.set_message.assert_called()


def test_rolling_discovery_and_worker_targets_with_imported_cookies(redis):
    rolling = RollingWindow(CHANNEL, CONFIG)
    rolling.settings = Mock(
        return_value={
            "rolling_window_size": 2,
            "subscriptions_channel_size": 50,
        }
    )
    rolling.ignored = Mock(return_value=set())

    def playlist(ie, url):
        return ie.playlist_result(
            [
                ie.url_result(
                    f"https://www.youtube.com/watch?v={v}", YoutubeIE, v
                )
                for v in IDS
            ],
            CHANNEL,
            playlist_count=3,
        )

    with patch.object(YoutubeTabIE, "_real_extract", playlist), patch.object(
        YoutubeIE, "_real_extract", detail
    ):
        assert [v["id"] for v in rolling.targets()] == [IDS[0], IDS[2]]
        downloader = object.__new__(VideoDownloader)
        downloader.config = CONFIG
        downloader.task = None
        downloader.rolling_windows = {CHANNEL: rolling}
        downloader._handle_error = Mock()
        for video_id in (IDS[0], IDS[2]):
            assert downloader._rolling_admit(
                {
                    "youtube_id": video_id,
                    "channel_id": CHANNEL,
                    "vid_type": "videos",
                }
            )
        downloader._handle_error.assert_not_called()


def test_invalid_cookie_fails_closed_without_leaking_contents(redis, capsys):
    redis.get_message_str.return_value = "synthetic-secret-invalid-header\n"
    rolling = RollingWindow(CHANNEL, CONFIG)
    rolling.settings = Mock(
        return_value={
            "rolling_window_size": 2,
            "subscriptions_channel_size": 50,
        }
    )
    rolling.ignored = Mock(return_value=set())
    with patch.object(YoutubeTabIE, "_real_extract") as extract, patch(
        "download.src.rolling_window.YoutubeVideo"
    ) as video:
        with pytest.raises(ValueError):
            rolling.reconcile()
        extract.assert_not_called()
        video.assert_not_called()
    captured = capsys.readouterr()
    assert "synthetic-secret" not in captured.out + captured.err
    redis.set_message.assert_not_called()
