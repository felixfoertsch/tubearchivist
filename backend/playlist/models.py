"""Upstream playlists retain unavailable video membership."""

from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVector
from django.db import models


class Playlist(models.Model):
    id = models.CharField(primary_key=True, max_length=128)
    name = models.TextField(default="")
    description = models.TextField(default="", null=True)
    channel_id = models.CharField(max_length=64, default="", db_index=True)
    channel_name = models.TextField(default="")
    active = models.BooleanField(default=True, db_index=True)
    subscribed = models.BooleanField(default=False, db_index=True)
    sort_order = models.CharField(max_length=16, default="top")
    playlist_type = models.CharField(max_length=16, default="regular")
    last_refresh = models.BigIntegerField(default=0)
    metadata = models.JSONField(default=dict)

    class Meta:
        ordering = ["name", "id"]
        indexes = [
            GinIndex(
                SearchVector("name", "description", config="english"),
                name="playlist_text_fts",
            )
        ]


class PlaylistEntry(models.Model):
    playlist = models.ForeignKey(
        Playlist, on_delete=models.CASCADE, related_name="entries"
    )
    video_id = models.CharField(max_length=64, db_index=True)
    position = models.PositiveIntegerField()
    title = models.TextField(default="")
    uploader = models.TextField(null=True)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["playlist", "position"], name="playlist_entry_position"
            )
        ]
