"""Application-wide configuration."""

from django.db import models


class ApplicationSettings(models.Model):
    id = models.PositiveSmallIntegerField(
        primary_key=True, default=1, editable=False
    )
    sections = models.JSONField(default=dict)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(id=1), name="application_settings_singleton"
            )
        ]
