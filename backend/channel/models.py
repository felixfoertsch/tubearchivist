"""Archived channel metadata."""

from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVector
from django.db import models


class Channel(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    name = models.TextField(default="")
    description = models.TextField(default="", null=True)
    active = models.BooleanField(default=True, db_index=True)
    subscribed = models.BooleanField(default=False, db_index=True)
    last_refresh = models.BigIntegerField(default=0)
    overrides = models.JSONField(default=dict)
    metadata = models.JSONField(default=dict)

    class Meta:
        ordering = ["name", "id"]
        indexes = [
            GinIndex(
                SearchVector("name", "description", config="english"),
                name="channel_text_fts",
            )
        ]
