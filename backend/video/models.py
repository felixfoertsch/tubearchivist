"""Archived videos and dependent content."""

from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVector
from django.db import models


class Video(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    channel = models.ForeignKey(
        "channel.Channel", on_delete=models.PROTECT, related_name="videos"
    )
    title = models.TextField(default="")
    description = models.TextField(default="", null=True)
    published = models.DateTimeField(null=True, db_index=True)
    downloaded_at = models.DateTimeField(null=True, db_index=True)
    last_refresh = models.BigIntegerField(default=0)
    video_type = models.CharField(
        max_length=16, default="videos", db_index=True
    )
    active = models.BooleanField(default=True, db_index=True)
    watched = models.BooleanField(default=False, db_index=True)
    watched_at = models.BigIntegerField(null=True)
    duration = models.FloatField(default=0)
    media_url = models.TextField(default="")
    media_size = models.BigIntegerField(default=0)
    view_count = models.BigIntegerField(default=0)
    like_count = models.BigIntegerField(default=0)
    dislike_count = models.BigIntegerField(default=0)
    tags = models.JSONField(default=list)
    metadata = models.JSONField(default=dict)

    class Meta:
        ordering = ["-published", "id"]
        indexes = [
            GinIndex(
                fields=["title"],
                opclasses=["gin_trgm_ops"],
                name="video_title_trgm",
            ),
            GinIndex(
                SearchVector("title", "description", config="english"),
                name="video_text_fts",
            ),
        ]


class SubtitleFragment(models.Model):
    video = models.ForeignKey(
        Video, on_delete=models.CASCADE, related_name="subtitle_fragments"
    )
    language = models.CharField(max_length=32)
    source = models.CharField(max_length=32)
    position = models.PositiveIntegerField()
    start = models.FloatField()
    end = models.FloatField()
    text = models.TextField()
    metadata = models.JSONField(default=dict)

    class Meta:
        ordering = ["video_id", "language", "position"]
        constraints = [
            models.UniqueConstraint(
                fields=["video", "language", "source", "position"],
                name="subtitle_fragment_identity",
            )
        ]
        indexes = [
            GinIndex(
                SearchVector("text", config="english"),
                name="subtitle_text_fts",
            )
        ]


class VideoComments(models.Model):
    video = models.OneToOneField(
        Video,
        primary_key=True,
        on_delete=models.CASCADE,
        related_name="comments",
    )
    comments = models.JSONField(default=list)
    last_refresh = models.BigIntegerField(default=0)
