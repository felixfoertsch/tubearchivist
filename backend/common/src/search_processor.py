"""Convert PostgreSQL-backed API results to existing frontend wire format."""

import urllib.parse
from pathlib import Path

from common.src.helper import date_parser
from common.src.runtime import RuntimeStore
from download.src.thumbnails import ThumbManager


class SearchProcess:
    """Convert raw domain records at API presentation boundary."""

    def __init__(self, response, match_video_user_progress=None):
        self.response = response
        self.position_index = self.get_user_progress(match_video_user_progress)

    def process(self):
        if isinstance(self.response, list):
            return [self._process_result(item) for item in self.response]
        if isinstance(self.response, dict):
            return self._process_result(self.response)
        return self.response

    def get_user_progress(self, user_id):
        if not user_id:
            return None
        positions = RuntimeStore().list_items(f"{user_id}:progress:")
        return {
            item["youtube_id"]: item["position"]
            for item in positions
            if item.get("youtube_id")
            and "position" in item
            and not item.get("watched")
        }

    @staticmethod
    def add_video_progress(item, user_id):
        positions = (
            RuntimeStore().list_items(f"{user_id}:progress:")
            if user_id
            else []
        )
        position = next(
            (
                row["position"]
                for row in positions
                if row.get("youtube_id") == item.get("youtube_id")
                and not row.get("watched")
            ),
            None,
        )
        duration = item.get("player", {}).get("duration")
        if position and duration:
            item["player"].update(
                progress=100 * position / duration, position=position
            )
        return item

    def _process_result(self, result):
        wire = result.get("_source", result).copy()
        index = result.get("_index", self._infer_index(wire))
        if index.startswith("ta_video"):
            processed = self._process_video(wire)
        elif index.startswith("ta_channel"):
            processed = self._process_channel(wire)
        elif index.startswith("ta_playlist"):
            processed = self._process_playlist(wire)
        elif index.startswith("ta_subtitle"):
            processed = self._process_subtitle(wire, result.get("highlight"))
        else:
            processed = wire
        if isinstance(processed, dict) and (
            "_index" in result or "_source" in result
        ):
            # SearchForm needs envelope for grouping and ranking.
            processed.update(
                _index=index, _score=round(result.get("_score") or 0, 2)
            )
        return processed

    @staticmethod
    def _infer_index(data):
        if "youtube_id" in data and "status" in data:
            return "ta_download"
        if "youtube_id" in data:
            return "ta_video"
        if "channel_id" in data:
            return "ta_channel"
        if "playlist_id" in data:
            return "ta_playlist"
        return "ta_subtitle"

    @staticmethod
    def _process_channel(data):
        return _process_channel_wire(data)

    def _process_video(self, data):
        data = data.copy()
        video_id = data["youtube_id"]
        media_url = data.get("media_url") or ""
        data["media_url"] = f"/media/stream/{urllib.parse.quote(media_url)}"
        data["vid_last_refresh"] = date_parser(data.get("vid_last_refresh"))
        data["published"] = date_parser(data.get("published"))
        data["vid_thumb_url"] = f"/media/thumb/video/{video_id}.jpg"
        if "duration_str" not in data.get("player", {}):
            from common.src.helper import get_duration_str

            data.setdefault("player", {})["duration_str"] = get_duration_str(
                data["player"].get("duration") or 0
            )
        streams = data.get("metadata", {}).get("streams")
        if streams is not None:
            data["streams"] = streams
        data["category"] = data.get("metadata", {}).get(
            "category", data.get("category", [])
        )
        channel = data.get("channel")
        if isinstance(channel, dict) and "channel_id" in channel:
            data["channel"] = self._process_channel(channel)
        for subtitle in data.get("subtitles", []):
            subtitle["media_url"] = f"/media/subtitle/{subtitle['media_url']}"
        data.setdefault("subtitles", [])
        data.setdefault("playlist", [])
        if self.position_index:
            position = self.position_index.get(video_id)
            duration = data.get("player", {}).get("duration")
            if position and duration:
                data["player"].update(
                    progress=100 * position / duration, position=position
                )
        return dict(sorted(data.items()))

    @staticmethod
    def _process_playlist(data):
        data = data.copy()
        data["playlist_last_refresh"] = date_parser(
            data.get("playlist_last_refresh")
        )
        entries = data.get("playlist_entries", [])
        thumbnail = f"/media/thumb/playlist/{data['playlist_id']}.jpg"
        if entries and entries[0].get("downloaded"):
            video_id = entries[0]["youtube_id"]
            if Path(
                ThumbManager(video_id).vid_thumb_path(absolute=True)
            ).exists():
                thumbnail = f"/media/thumb/video/{video_id}.jpg"
        data["playlist_thumbnail"] = thumbnail
        return dict(sorted(data.items()))

    @staticmethod
    def _process_subtitle(data, highlight=None):
        data = data.copy()
        if highlight:
            data["subtitle_line"] = highlight
        data["vid_thumb_url"] = f"/media/thumb/video/{data['youtube_id']}.jpg"
        return data


def _process_channel_wire(data):
    data = data.copy()
    channel_id = data["channel_id"]
    data["channel_last_refresh"] = date_parser(
        data.get("channel_last_refresh")
    )
    data.setdefault("channel_subs", 0)
    data.setdefault("channel_tabs", ["videos"])
    for key, name in (
        ("channel_banner_url", "banner"),
        ("channel_thumb_url", "thumb"),
        ("channel_tvart_url", "tvart"),
    ):
        data[key] = (
            f"/media/thumb/channel/{channel_id}/{name}.jpg"
            if data.get(key)
            else None
        )
    return dict(sorted(data.items()))
