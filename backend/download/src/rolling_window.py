"""Regular-video retention; discovery errors never grant deletion."""

import os
import re
from datetime import datetime, timezone

from common.src.env_settings import EnvironmentSettings
from common.src.es_connect import ElasticWrap, IndexPaginate
from download.src.yt_dlp_base import YtWrap
from video.src.index import YoutubeVideo


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
    """Use current channel settings, not stale embedded overwrites."""
    if video.get("vid_type") != "videos":
        return False
    rolling = RollingWindow(video["channel"]["channel_id"], {})
    settings = rolling.settings()
    # Invalid enabled settings must not fall back to destructive age cleanup.
    if settings.get("rolling_window_size") is None:
        return False
    return rolling.enabled(settings)


def reconcile_windows(config, task=None):
    """Existing scans and downloads share one fail-closed cleanup boundary."""
    from common.src.helper import get_channels

    for channel in get_channels(subscribed_only=False):
        overwrites = channel.get("channel_overwrites", {})
        if overwrites.get("rolling_window_size") is None:
            continue
        try:
            RollingWindow(channel["channel_id"], config, task).reconcile()
        except (ValueError, KeyError, TypeError, OSError) as err:
            print(f"{channel['channel_id']}: rolling cleanup refused: {err}")


class RollingWindow:
    """Recompute targets rather than retaining stale destructive snapshots.

    All targets must have archive media and no regular pending entries may
    remain. Eviction uses normal deletion, never permanent queue ignores.
    """

    def __init__(self, channel_id, config, task=None):
        self.channel_id = channel_id
        self.config = config
        self.task = task
        self.cached = None

    def settings(self):
        """Read authoritative settings at each boundary."""
        response, status = ElasticWrap(
            f"ta_channel/_doc/{self.channel_id}"
        ).get(print_error=False)
        if status == 404 and response.get("found") is False:
            return {}
        if status != 200 or not isinstance(response.get("_source"), dict):
            raise ValueError("Cannot verify rolling window settings")
        settings = response["_source"].get("channel_overwrites", {}).copy()
        if settings.get("rolling_window_size") is not None:
            settings["subscriptions_channel_size"] = self.effective_depth(
                settings
            )
        return settings

    def effective_depth(self, settings):
        """Project only inherited policy, never trust constructor config."""
        depth = settings.get("subscriptions_channel_size")
        if depth is not None:
            return depth
        from appsettings.src.config import AppConfig

        response, status = ElasticWrap(
            AppConfig.ES_PATH + "?_source_includes=subscriptions.channel_size"
        ).get(print_error=False)
        if status != 200:
            raise ValueError("Cannot verify regular subscription policy")
        return response["_source"]["subscriptions"]["channel_size"]

    def enabled(self, settings):
        """Explicitly disabled regular subscriptions stay disabled."""
        if window_size(settings) is None:
            return False
        return self.effective_depth(settings) != 0

    def ignored(self):
        """Manual ignores remain authoritative during discovery."""
        data = {
            "query": {
                "bool": {
                    "filter": [
                        {"term": {"channel_id": self.channel_id}},
                        {"term": {"status": "ignore"}},
                    ]
                }
            }
        }
        return {
            v["youtube_id"]
            for v in IndexPaginate(
                "ta_download", data, strict=True
            ).get_results()
        }

    @staticmethod
    def published(entry):
        """Normalize upload dates without inventing an unknown date."""
        timestamp = entry.get("timestamp")
        if type(timestamp) in (int, float) and timestamp > 0:
            return datetime.fromtimestamp(timestamp, timezone.utc).timestamp()
        upload_date = entry.get("upload_date")
        if not isinstance(upload_date, str):
            raise ValueError("Uncertain rolling upload date")
        return (
            datetime.strptime(upload_date, "%Y%m%d")
            .replace(tzinfo=timezone.utc)
            .timestamp()
        )

    def targets(self):
        """Reuse read-only discovery within one worker, never stale policy."""
        settings, ignored = self.settings(), self.ignored()
        signature = (settings, ignored)
        if self.cached is None or self.cached[0] != signature:
            entries = self.discover()
            if self.settings() != settings or self.ignored() != ignored:
                raise ValueError("Rolling settings changed during discovery")
            self.cached = (signature, entries)
        return self.cached[1]

    def recent_entries(self):
        """Enumerate full tab without assuming server publication order.

        ponytail: full extraction costs one detail lookup per upload;
        reuse per worker, add verified publication caching if cost warrants it.
        yt-dlp cannot prove invisible server omissions; reject observable
        transport incompleteness instead of treating it as an empty tail.
        """
        obs = {
            "skip_download": True,
            "extract_flat": "in_playlist",
            "ignoreerrors": False,
            "extractor_args": {"youtube": {"raise_incomplete_data": ["true"]}},
        }
        response, error = YtWrap(obs, self.config).extract(
            f"https://www.youtube.com/channel/{self.channel_id}/videos"
        )
        if error or not response or not response.get("entries"):
            raise ValueError("Incomplete rolling channel discovery")
        entries = list(response["entries"])
        count = response.get("playlist_count")
        if count is not None and count != len(entries):
            raise ValueError("Incomplete rolling playlist")
        return self.accessible_entries(entries, obs)

    def accessible_entries(self, entries, obs):
        """Resolve identities, skipping only proven access failures."""
        accessible = []
        obs["extract_flat"] = False
        wrapper = YtWrap(obs, self.config)
        for entry in entries:
            if self.task and self.task.is_stopped():
                raise ValueError("Rolling discovery stopped")
            if not entry:
                raise ValueError("Incomplete rolling entry identity")
            if entry.get("_type") in ("url", "url_transparent"):
                video_id = entry.get("id", "")
                if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
                    raise ValueError("Incomplete rolling entry identity")
                if entry.get("availability") in (
                    "private",
                    "subscriber_only",
                    "premium_only",
                ):
                    continue
                entry, error = wrapper.extract(
                    f"https://www.youtube.com/watch?v={video_id}",
                    unavailable_ok=True,
                )
                if error or not entry:
                    raise ValueError("Incomplete rolling video discovery")
                if entry.get("_type") == "unavailable":
                    continue
                if entry.get("id") != video_id:
                    raise ValueError("Changed rolling video identity")
            accessible.append(entry)
        return accessible

    def discover(self):
        """Read full regular tab, independent of scan-depth settings."""
        settings = self.settings()
        size = window_size(settings)
        if not self.enabled(settings):
            return []
        pattern = re.compile(settings.get("auto_ignore_filter") or "(?!)")
        ignored = self.ignored()
        entries = self.recent_entries()
        candidates = {}
        for entry in entries:
            if self.task and self.task.is_stopped():
                raise ValueError("Rolling discovery stopped")
            if (
                not entry
                or not entry.get("id")
                or not entry.get("title")
                or entry.get("channel_id") != self.channel_id
                or entry.get("live_status") in ("is_live", "is_upcoming")
                or entry.get("availability")
                not in (None, "public", "unlisted")
            ):
                raise ValueError("Unavailable or incomplete rolling entry")
            if entry.get("live_status") == "was_live":
                continue
            published = self.published(entry)
            if entry["id"] in ignored or pattern.search(entry["title"]):
                continue
            candidates[entry["id"]] = (published, entry)
        if not candidates:
            raise ValueError("Empty eligible rolling window")
        ordered = sorted(
            candidates.values(), key=lambda v: (-v[0], v[1]["id"])
        )
        return [entry for _, entry in ordered[:size]]

    def reconcile(self):
        """Require fresh targets, complete media and unchanged policy."""
        before = self.settings()
        if not self.enabled(before):
            return
        ignored = self.ignored()
        targets = {entry["id"] for entry in self.discover()}
        if self.ignored() != ignored or self.settings() != before:
            return
        data = {
            "query": {
                "bool": {
                    "filter": [
                        {"term": {"channel.channel_id": self.channel_id}},
                        {"term": {"vid_type": "videos"}},
                    ]
                }
            }
        }
        archived = IndexPaginate("ta_video", data, strict=True).get_results()
        available = {
            v["youtube_id"]
            for v in archived
            if os.path.isfile(
                os.path.join(EnvironmentSettings.MEDIA_DIR, v["media_url"])
            )
        }
        if not targets or not targets.issubset(available):
            return
        if self.pending():
            return
        for video in archived:
            if (
                self.settings() != before
                or self.ignored() != ignored
                or (self.task and self.task.is_stopped())
            ):
                return
            if video["youtube_id"] not in targets:
                current = IndexPaginate(
                    "ta_video", data, strict=True
                ).get_results()
                available = {
                    v["youtube_id"]
                    for v in current
                    if os.path.isfile(
                        os.path.join(
                            EnvironmentSettings.MEDIA_DIR, v["media_url"]
                        )
                    )
                }
                if self.pending() or not targets.issubset(available):
                    return
                YoutubeVideo(video["youtube_id"]).delete_media_file()

    def pending(self):
        """Read pending gate immediately before every eviction."""
        return IndexPaginate(
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
