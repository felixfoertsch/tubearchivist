"""Bounded regular-video retention; failed fetches never grant deletion."""

from channel.src.remote_query import get_last_channel_videos
from common.src.es_connect import ElasticWrap, IndexPaginate
from download.src.queue import delete_and_ignore
from video.src.constants import VideoTypeEnum


def window_size(overwrites):
    """Validate persisted settings without coercing bools or floats."""
    value = overwrites.get("rolling_window_size")
    if value is not None and (
        type(value) is not int or not 1 <= value <= 2147483647
    ):
        raise ValueError(
            "rolling_window_size must be 1–2147483647 (integer) or null"
        )
    return value


def owns_video(video, config):
    """Use current settings for the watched-age cleanup exemption."""
    if video.get("vid_type") != "videos":
        return False
    rolling = RollingWindow(video["channel"]["channel_id"], config)
    return rolling.enabled(rolling.settings())


def reconcile_windows(config, task=None):
    """Existing scans and downloads share one cleanup boundary."""
    from common.src.helper import get_channels

    for channel in get_channels(subscribed_only=False):
        if (
            channel.get("channel_overwrites", {}).get("rolling_window_size")
            is None
        ):
            continue
        try:
            RollingWindow(channel["channel_id"], config, task).reconcile()
        except (ValueError, KeyError, TypeError, OSError) as err:
            print(f"{channel['channel_id']}: rolling cleanup refused: {err}")


class RollingWindow:
    """Trust newest-first tab order, wait for pending regular downloads."""

    def __init__(self, channel_id, config, task=None):
        self.channel_id = channel_id
        self.config = config
        self.task = task

    def settings(self):
        """Read channel settings once per cleanup boundary."""
        response, status = ElasticWrap(
            f"ta_channel/_doc/{self.channel_id}"
        ).get(print_error=False)
        if status == 404 and response.get("found") is False:
            return {}
        if status != 200 or not isinstance(response.get("_source"), dict):
            raise ValueError("Cannot verify rolling window settings")
        return response["_source"].get("channel_overwrites", {})

    def enabled(self, settings):
        """Explicitly disabled regular subscriptions stay disabled."""
        if window_size(settings) is None:
            return False
        depth = settings.get("subscriptions_channel_size")
        if depth is None:
            depth = self.config["subscriptions"]["channel_size"]
        return depth != 0

    def reconcile(self):
        """Require bounded fetch success and finished downloads to prune."""
        settings = self.settings()
        if not self.enabled(settings) or (
            self.task and self.task.is_stopped()
        ):
            return
        try:
            entries = get_last_channel_videos(
                self.channel_id,
                self.config,
                limit=window_size(settings),
                query_filter=VideoTypeEnum.VIDEOS,
            )
        except (ValueError, KeyError, TypeError, OSError) as err:
            print(f"{self.channel_id}: rolling fetch refused: {err}")
            return
        if not entries or any(
            not entry or not entry.get("id") for entry in entries
        ):
            return
        targets = {entry["id"] for entry in entries}
        pending = IndexPaginate(
            "ta_download",
            {
                "query": {
                    "bool": {
                        "filter": [
                            {"term": {"channel_id": self.channel_id}},
                            {"term": {"status": "pending"}},
                            {"term": {"vid_type": "videos"}},
                        ]
                    }
                }
            },
            strict=True,
        ).get_results()
        if pending or (self.task and self.task.is_stopped()):
            return
        archived = IndexPaginate(
            "ta_video",
            {
                "query": {
                    "bool": {
                        "filter": [
                            {"term": {"channel.channel_id": self.channel_id}},
                            {"term": {"vid_type": "videos"}},
                        ]
                    }
                }
            },
            strict=True,
        ).get_results()
        delete_and_ignore(
            [
                video
                for video in archived
                if video["vid_type"] == "videos"
                and video["youtube_id"] not in targets
            ]
        )
