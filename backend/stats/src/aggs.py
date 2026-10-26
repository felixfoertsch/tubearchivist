"""Native PostgreSQL statistics aggregations."""

from datetime import timedelta

from channel.models import Channel as ChannelModel
from common.src.helper import get_duration_str
from django.db.models import Count, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from download.models import Download as DownloadModel
from playlist.models import Playlist as PlaylistModel
from video.models import Video as VideoModel


class Video:
    def process(self):
        rows = VideoModel.objects.values("video_type").annotate(
            count=Count("id"), size=Sum("media_size"), duration=Sum("duration")
        )
        all_values = VideoModel.objects.aggregate(
            count=Count("id"), size=Sum("media_size"), duration=Sum("duration")
        )
        result = _video_stats(all_values)
        for video_type in ("videos", "shorts", "streams"):
            result[f"type_{video_type}"] = _video_stats(
                next(
                    (row for row in rows if row["video_type"] == video_type),
                    {},
                )
            )
        for active in (True, False):
            result[f"active_{str(active).lower()}"] = _video_stats(
                VideoModel.objects.filter(active=active).aggregate(
                    count=Count("id"),
                    size=Sum("media_size"),
                    duration=Sum("duration"),
                )
            )
        return result


def _video_stats(data):
    duration = int(data.get("duration") or 0)
    return {
        "doc_count": data.get("count") or 0,
        "media_size": int(data.get("size") or 0),
        "duration": duration,
        "duration_str": get_duration_str(duration),
    }


class Channel:
    def process(self):
        return _boolean_stats(ChannelModel.objects.all())


class Playlist:
    def process(self):
        return _boolean_stats(PlaylistModel.objects.all())


def _boolean_stats(queryset):
    result = {"doc_count": queryset.count()}
    for field in ("active", "subscribed"):
        for value in (True, False):
            result[f"{field}_{str(value).lower()}"] = queryset.filter(
                **{field: value}
            ).count()
    return result


class Download:
    def process(self):
        rows = DownloadModel.objects.values("status").annotate(
            count=Count("id")
        )
        result = {row["status"]: row["count"] for row in rows}
        for video_type in ("videos", "shorts", "streams"):
            result[f"pending_{video_type}"] = DownloadModel.objects.filter(
                status="pending", video_type=video_type
            ).count()
        return result


class WatchProgress:
    def process(self):
        total = VideoModel.objects.aggregate(
            duration=Sum("duration"), items=Count("id")
        )
        duration = int(total["duration"] or 0)
        result = {
            "total": {
                "duration": duration,
                "duration_str": get_duration_str(duration),
                "items": total["items"],
            }
        }
        for watched, key in ((False, "unwatched"), (True, "watched")):
            data = VideoModel.objects.filter(watched=watched).aggregate(
                duration=Sum("duration"), items=Count("id")
            )
            value = int(data["duration"] or 0)
            result[key] = {
                "duration": value,
                "duration_str": get_duration_str(value),
                "progress": value / duration if duration else 0,
                "items": data["items"],
            }
        return result


class DownloadHist:
    def process(self):
        start = timezone.localdate() - timedelta(days=7)
        rows = (
            VideoModel.objects.filter(downloaded_at__date__gte=start)
            .annotate(
                day=TruncDate(
                    "downloaded_at", tzinfo=timezone.get_current_timezone()
                )
            )
            .values("day")
            .annotate(count=Count("id"), size=Sum("media_size"))
            .order_by("-day")
        )
        return [
            {
                "date": row["day"].isoformat(),
                "count": row["count"],
                "media_size": row["size"] or 0,
            }
            for row in rows
        ]


class BiggestChannel:
    def __init__(self, order):
        self.order = order

    def process(self):
        ordering = {
            "doc_count": "-count",
            "duration": "-duration",
            "media_size": "-size",
        }[self.order]
        rows = (
            VideoModel.objects.values("channel_id", "channel__name")
            .annotate(
                count=Count("id"),
                duration=Sum("duration"),
                size=Sum("media_size"),
            )
            .order_by(ordering, "channel_id")[:30]
        )
        return [
            {
                "id": row["channel_id"],
                "name": row["channel__name"].title(),
                "doc_count": row["count"],
                "duration": row["duration"] or 0,
                "duration_str": get_duration_str(row["duration"] or 0),
                "media_size": row["size"] or 0,
            }
            for row in rows
        ]
