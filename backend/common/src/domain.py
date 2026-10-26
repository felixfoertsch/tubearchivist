"""Domain persistence and existing public representations."""

from datetime import datetime, timezone

from channel.models import Channel
from django.db import transaction
from download.models import Download
from playlist.models import Playlist, PlaylistEntry
from video.models import Video


def _date(value):
    if value is None or value is False:
        return None
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, (int, float)):
        parsed = datetime.fromtimestamp(value, tz=timezone.utc)
    else:
        parsed = datetime.fromisoformat(value)
    return (
        parsed.replace(tzinfo=timezone.utc)
        if parsed.tzinfo is None
        else parsed
    )


def _extra(data, fields):
    return {key: value for key, value in data.items() if key not in fields}


CHANNEL_FIELDS = {
    "channel_id",
    "channel_name",
    "channel_description",
    "channel_active",
    "channel_subscribed",
    "channel_last_refresh",
    "channel_overwrites",
}


def channel_data(channel):
    return {
        **channel.metadata,
        "channel_id": channel.pk,
        "channel_name": channel.name,
        "channel_description": channel.description,
        "channel_active": channel.active,
        "channel_subscribed": channel.subscribed,
        "channel_last_refresh": channel.last_refresh,
        "channel_overwrites": channel.overrides,
    }


def save_channel(data):
    obj, _ = Channel.objects.update_or_create(
        id=data["channel_id"],
        defaults={
            "name": data.get("channel_name", ""),
            "description": data.get("channel_description", ""),
            "active": data.get("channel_active", True),
            "subscribed": data.get("channel_subscribed", False),
            "last_refresh": data.get("channel_last_refresh", 0),
            "overrides": data.get("channel_overwrites") or {},
            "metadata": _extra(data, CHANNEL_FIELDS),
        },
    )
    return obj


VIDEO_FIELDS = {
    "youtube_id",
    "channel",
    "title",
    "description",
    "published",
    "date_downloaded",
    "vid_last_refresh",
    "vid_type",
    "active",
    "player",
    "media_url",
    "media_size",
    "stats",
    "tags",
    "playlist",
}


def video_data(video):
    player = {
        **video.metadata.get("player", {}),
        "duration": video.duration,
        "watched": video.watched,
    }
    if video.watched_at is not None:
        player["watched_date"] = video.watched_at
    stats = {
        **video.metadata.get("stats", {}),
        "view_count": video.view_count,
        "like_count": video.like_count,
        "dislike_count": video.dislike_count,
    }
    result = {
        **video.metadata,
        "youtube_id": video.pk,
        "channel": channel_data(video.channel),
        "title": video.title,
        "description": video.description,
        "published": video.published.isoformat() if video.published else None,
        "date_downloaded": (
            int(video.downloaded_at.timestamp())
            if video.downloaded_at
            else None
        ),
        "vid_last_refresh": video.last_refresh,
        "vid_type": video.video_type,
        "active": video.active,
        "player": player,
        "media_url": video.media_url,
        "media_size": video.media_size,
        "stats": stats,
        "tags": video.tags,
    }
    memberships = list(
        PlaylistEntry.objects.filter(video_id=video.pk)
        .values_list("playlist_id", flat=True)
        .distinct()
    )
    if memberships:
        result["playlist"] = memberships
    return result


@transaction.atomic
def save_video(data):
    channel = Channel.objects.get(pk=data["channel"]["channel_id"])
    player = data.get("player", {})
    stats = data.get("stats", {})
    metadata = _extra(data, VIDEO_FIELDS)
    metadata["player"] = _extra(
        player, {"duration", "watched", "watched_date"}
    )
    metadata["stats"] = _extra(
        stats, {"view_count", "like_count", "dislike_count"}
    )
    obj, _ = Video.objects.update_or_create(
        id=data["youtube_id"],
        defaults={
            "channel": channel,
            "title": data.get("title", ""),
            "description": data.get("description", ""),
            "published": _date(data.get("published")),
            "downloaded_at": _date(data.get("date_downloaded")),
            "last_refresh": data.get("vid_last_refresh", 0),
            "video_type": data.get("vid_type", "videos"),
            "active": data.get("active", True),
            "watched": player.get("watched", False),
            "watched_at": player.get("watched_date"),
            "duration": player.get("duration", 0),
            "media_url": data.get("media_url", ""),
            "media_size": data.get("media_size", 0),
            "view_count": stats.get("view_count", 0),
            "like_count": stats.get("like_count", 0),
            "dislike_count": stats.get("dislike_count", 0),
            "tags": data.get("tags", []),
            "metadata": metadata,
        },
    )
    return obj


PLAYLIST_FIELDS = {
    "playlist_id",
    "playlist_name",
    "playlist_description",
    "playlist_channel_id",
    "playlist_channel",
    "playlist_active",
    "playlist_subscribed",
    "playlist_sort_order",
    "playlist_type",
    "playlist_last_refresh",
    "playlist_entries",
}


def playlist_data(playlist):
    entries = list(playlist.entries.all())
    downloaded = set(
        Video.objects.filter(
            pk__in=[entry.video_id for entry in entries]
        ).values_list("pk", flat=True)
    )
    return {
        **playlist.metadata,
        "playlist_id": playlist.pk,
        "playlist_name": playlist.name,
        "playlist_description": playlist.description,
        "playlist_channel_id": playlist.channel_id or "",
        "playlist_channel": playlist.channel_name or "",
        "playlist_active": playlist.active,
        "playlist_subscribed": playlist.subscribed,
        "playlist_sort_order": playlist.sort_order,
        "playlist_type": playlist.playlist_type,
        "playlist_last_refresh": playlist.last_refresh,
        "playlist_entries": [
            {
                "youtube_id": entry.video_id,
                "idx": entry.position,
                "title": entry.title,
                "uploader": entry.uploader,
                "downloaded": entry.video_id in downloaded,
            }
            for entry in entries
        ],
    }


@transaction.atomic
def save_playlist(data):
    obj, _ = Playlist.objects.update_or_create(
        id=data["playlist_id"],
        defaults={
            "name": data.get("playlist_name", ""),
            "description": data.get("playlist_description", ""),
            "channel_id": data.get("playlist_channel_id") or "",
            "channel_name": data.get("playlist_channel") or "",
            "active": data.get("playlist_active", True),
            "subscribed": data.get("playlist_subscribed", False),
            "sort_order": data.get("playlist_sort_order", "top"),
            "playlist_type": data.get("playlist_type", "regular"),
            "last_refresh": data.get("playlist_last_refresh", 0),
            "metadata": _extra(data, PLAYLIST_FIELDS),
        },
    )
    if "playlist_entries" in data:
        obj.entries.all().delete()
        PlaylistEntry.objects.bulk_create(
            [
                PlaylistEntry(
                    playlist=obj,
                    video_id=entry["youtube_id"],
                    position=position,
                    title=entry.get("title") or "",
                    uploader=entry.get("uploader"),
                )
                for position, entry in enumerate(data["playlist_entries"])
            ]
        )
    return obj


DOWNLOAD_FIELDS = {
    "youtube_id",
    "channel_id",
    "title",
    "status",
    "vid_type",
    "timestamp",
}


def download_data(download):
    return {
        **download.metadata,
        "youtube_id": download.pk,
        "channel_id": download.channel_id,
        "title": download.title,
        "status": download.status,
        "vid_type": download.video_type,
        "timestamp": download.timestamp,
    }


@transaction.atomic
def save_download(data):
    values = {
        "channel_id": data.get("channel_id", ""),
        "title": data.get("title", ""),
        "status": data.get("status", "pending"),
        "video_type": data.get("vid_type", "videos"),
        "timestamp": data.get("timestamp", 0),
        "metadata": _extra(data, DOWNLOAD_FIELDS),
    }
    Download.objects.get_or_create(id=data["youtube_id"], defaults=values)
    obj = Download.objects.select_for_update().get(pk=data["youtube_id"])
    # Lock after insertion too: concurrent discovery must not undo an ignore.
    if obj.status == "ignore" and values["status"] != "ignore":
        return obj
    for field, value in values.items():
        setattr(obj, field, value)
    obj.save(update_fields=list(values))
    return obj
