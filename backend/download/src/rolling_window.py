"""Bounded regular-video retention; failed fetches never grant deletion."""

from channel.models import Channel
from channel.src.remote_query import get_last_channel_videos
from common.src.domain import video_data
from download.models import Download
from download.src.queue import delete_and_ignore
from video.models import Video
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
        channel = Channel.objects.filter(pk=self.channel_id).first()
        return channel.overrides if channel else {}

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
        pending = Download.objects.filter(
            channel_id=self.channel_id, status="pending", video_type="videos"
        ).exists()
        if pending or (self.task and self.task.is_stopped()):
            return
        archived = Video.objects.filter(
            channel_id=self.channel_id, video_type="videos"
        )
        delete_and_ignore(
            [
                video_data(video)
                for video in archived
                if video.video_type == "videos" and video.pk not in targets
            ]
        )
