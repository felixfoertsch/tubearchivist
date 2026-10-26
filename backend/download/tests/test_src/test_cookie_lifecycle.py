"""Real yt-dlp cookie load/save lifecycle, without network or real cookies."""

from unittest.mock import Mock, patch

import pytest
from download.src.yt_dlp_base import CookieHandler, YtWrap
from yt_dlp.extractor.youtube import YoutubeIE

BASE = "download.src.yt_dlp_base"
CHANNEL = "UCQHX6ViZmPsWiYSFAyS0a3Q"
IDS = ["00000000000", "00000000001", "00000000002"]
COOKIE = (
    "# Netscape HTTP Cookie File\n"
    ".example.invalid\tTRUE\t/\tFALSE\t0\tsynthetic\tvalue\n"
)
CONFIG = {"downloads": {"cookie_import": True}}


@pytest.fixture
def store():
    with patch(f"{BASE}.RuntimeStore") as store, patch(
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
    return {
        "id": video_id,
        "title": video_id,
        "channel_id": CHANNEL,
        "timestamp": 100 - IDS.index(video_id),
        "live_status": "not_live",
        "url": "https://example.invalid/a.mp4",
        "ext": "mp4",
    }


def test_repeated_extract_loads_saves_and_refreshes_cookies(store):
    wrapper = YtWrap({"skip_download": True}, CONFIG)
    with patch.object(YoutubeIE, "_real_extract", detail):
        for video_id in IDS + IDS[:1]:
            response, error = wrapper.extract(
                f"https://www.youtube.com/watch?v={video_id}",
            )
            assert error is None
            assert response["id"] == video_id
    saved = wrapper.obs["cookiefile"].getvalue()
    assert saved.startswith("# Netscape")
    assert "\x00" not in saved
    assert "synthetic\tvalue" in saved
    store.set_message.assert_called()


def test_cached_invalid_cookie_validation_fails_closed(store):
    store.get_message_dict.return_value = {"status": False}
    with patch(f"{BASE}.YtWrap") as wrapper:
        assert CookieHandler(CONFIG).validate() is False
        wrapper.assert_not_called()


def test_invalid_cookie_fails_closed_without_leaking_contents(store, capsys):
    store.get_message_str.return_value = "synthetic-secret-invalid-header\n"
    wrapper = YtWrap({"skip_download": True}, CONFIG)
    with patch.object(YoutubeIE, "_real_extract") as extract:
        response, error = wrapper.extract(
            f"https://www.youtube.com/watch?v={IDS[0]}"
        )
        assert response is None
        assert error == "Invalid cookie file"
        extract.assert_not_called()
    captured = capsys.readouterr()
    assert "synthetic-secret" not in captured.out + captured.err
    store.set_message.assert_not_called()
