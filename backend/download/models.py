"""Download queue independent from archived videos."""

from django.db import models


class Download(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    channel_id = models.CharField(max_length=64, default="", db_index=True)
    title = models.TextField(default="")
    status = models.CharField(max_length=32, default="pending", db_index=True)
    video_type = models.CharField(
        max_length=16, default="videos", db_index=True
    )
    timestamp = models.BigIntegerField(default=0, db_index=True)
    metadata = models.JSONField(default=dict)

    class Meta:
        ordering = ["timestamp", "id"]
