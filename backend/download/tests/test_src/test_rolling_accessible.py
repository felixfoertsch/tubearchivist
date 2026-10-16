"""Offline real yt-dlp playlist and per-video exception pathways."""

from unittest.mock import Mock, patch

import pytest
from download.src.queue import PendingList
from download.src.rolling_window import RollingWindow
from download.src.yt_dlp_base import YtWrap
from yt_dlp.extractor.youtube import YoutubeIE, YoutubeTabIE
from yt_dlp.utils import ExtractorError, GeoRestrictedError

MODULE = "download.src.rolling_window"
CHANNEL = "UCQHX6ViZmPsWiYSFAyS0a3Q"
IDS = [f"{i:011d}" for i in range(36)]


@pytest.fixture(autouse=True)
def wrapper_settings():
    with patch("download.src.yt_dlp_base.settings", Mock(DEBUG=False)), patch(
        "download.src.yt_dlp_base.rand_sleep"
    ):
        yield


def rolling():
    result = RollingWindow(CHANNEL, {})
    result.settings = Mock(
        return_value={
            "rolling_window_size": 30,
            "subscriptions_channel_size": 50,
        }
    )
    result.ignored = Mock(return_value=set())
    return result


def playlist(ie, url):
    return ie.playlist_result(
        [
            ie.url_result(
                f"https://www.youtube.com/watch?v={video_id}",
                YoutubeIE,
                video_id,
            )
            for video_id in IDS
        ],
        CHANNEL,
        playlist_count=len(IDS),
    )


def detail(errors):
    def extract(ie, url):
        video_id = ie._match_id(url)
        if video_id in errors:
            raise ExtractorError(errors[video_id], expected=True)
        return {
            "id": video_id,
            "title": video_id,
            "channel_id": CHANNEL,
            "channel": "Channel",
            "width": 1920,
            "height": 1080,
            "timestamp": 1000 - IDS.index(video_id),
            "live_status": "not_live",
            "url": "https://example.invalid/a.mp4",
            "ext": "mp4",
        }

    return extract


def test_unavailable_entries_do_not_block_public_thirty():
    errors = {
        IDS[0]: "Video unavailable",
        IDS[15]: "Private video",
        IDS[35]: "Join this channel to get access to members-only content "
        "like this video, and other exclusive perks.",
    }
    with patch.object(YoutubeTabIE, "_real_extract", playlist), patch.object(
        YoutubeIE, "_real_extract", detail(errors)
    ):
        assert [entry["id"] for entry in rolling().discover()] == [
            video_id for video_id in IDS if video_id not in errors
        ][:30]


@pytest.mark.parametrize(
    "message",
    [
        "HTTP Error 429: Too Many Requests",
        "Unable to download webpage: timed out",
        "Sign in to confirm you’re not a bot",
        "Video unavailable. Unknown error",
        "This content isn't available, try again later",
        "Requested format is not available",
    ],
)
def test_uncertain_errors_never_prune(message):
    with patch.object(YoutubeTabIE, "_real_extract", playlist), patch.object(
        YoutubeIE, "_real_extract", detail({IDS[1]: message})
    ), patch(f"{MODULE}.YoutubeVideo") as video:
        with pytest.raises((ValueError, ConnectionError)):
            rolling().reconcile()
        video.assert_not_called()


@pytest.mark.parametrize(
    "availability", ["private", "subscriber_only", "premium_only"]
)
def test_positive_stub_needs_no_date_title_or_channel(availability):
    def stub_playlist(ie, url):
        result = playlist(ie, url)
        result["entries"][0]["availability"] = availability
        return result

    with patch.object(
        YoutubeTabIE, "_real_extract", stub_playlist
    ), patch.object(
        YoutubeIE, "_real_extract", detail({IDS[0]: "Must not extract"})
    ):
        assert [v["id"] for v in rolling().discover()] == IDS[1:31]


@pytest.mark.parametrize("incomplete", ["count", "transport", "unknown_stub"])
def test_incomplete_enumeration_never_prunes(incomplete):
    def broken_playlist(ie, url):
        result = playlist(ie, url)
        if incomplete == "transport":
            first = result["entries"][0]

            def entries():
                yield first
                raise ExtractorError("Unable to download API page: timed out")

            result["entries"] = entries()
        elif incomplete == "count":
            result["playlist_count"] += 1
        else:
            result["entries"][0] = {"_type": "url", "id": IDS[0]}
            result["entries"][0]["availability"] = "needs_auth"
            result["entries"][0][
                "url"
            ] = f"https://www.youtube.com/watch?v={IDS[0]}"
        return result

    with patch.object(
        YoutubeTabIE, "_real_extract", broken_playlist
    ), patch.object(
        YoutubeIE,
        "_real_extract",
        detail({IDS[0]: "Sign in to confirm your age"}),
    ), patch(
        f"{MODULE}.YoutubeVideo"
    ) as video:
        with pytest.raises(ValueError):
            rolling().reconcile()
        video.assert_not_called()


def test_error_taxonomy_rejects_wrapped_transport_and_unexpected_errors():
    assert YtWrap._unavailable(GeoRestrictedError("Country restriction"))
    assert not YtWrap._unavailable(ExtractorError("Video unavailable"))
    assert not YtWrap._unavailable(
        ExtractorError(
            "Video unavailable", expected=True, cause=TimeoutError()
        )
    )


def test_real_discovery_admits_public_thirty_to_pending_list():
    pending = object.__new__(PendingList)
    pending.channel_overwrites = {CHANNEL: rolling().settings()}
    pending.config = {}
    pending.task = None
    pending.rolling_targets = {}
    pending.rolling_failed = False
    pending.admission_status = "pending"
    pending.missing_videos = []
    pending.to_skip = []
    pending.all_channels = [CHANNEL]
    pending.flat = True
    errors = {IDS[0]: "Video unavailable", IDS[15]: "Private video"}
    with patch.object(YoutubeTabIE, "_real_extract", playlist), patch.object(
        YoutubeIE, "_real_extract", detail(errors)
    ), patch.object(
        RollingWindow, "settings", return_value=rolling().settings()
    ), patch.object(
        RollingWindow, "ignored", return_value=set()
    ), patch.object(
        pending, "_retry_missing_media"
    ), patch.object(
        pending, "_notify_add"
    ), patch(
        "download.src.queue.YoutubeChannel"
    ) as channel:
        channel.return_value.json_data = {
            "channel_name": "Channel",
            "channel_id": CHANNEL,
        }
        pending._parse_channel({"url": CHANNEL, "vid_type": "videos"})
    assert not pending.rolling_failed
    assert [v["youtube_id"] for v in pending.missing_videos] == [
        video_id for video_id in IDS if video_id not in errors
    ][:30]
