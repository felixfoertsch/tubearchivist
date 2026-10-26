"""PostgreSQL-backed task state and schedule configuration."""

from django.db import models
from django.utils import timezone


class JobState(models.Model):
    """TubeArchivist task lifecycle details not stored by Procrastinate."""

    task_id = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=128)
    status = models.CharField(max_length=16, default="PENDING")
    result = models.TextField(null=True, blank=True)
    traceback = models.TextField(null=True, blank=True)
    date_done = models.DateTimeField(null=True, blank=True)
    command = models.CharField(max_length=16, null=True, blank=True)
    progress = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["-date_done", "-pk"]

    def set_status(self, status: str, *, result=None, traceback=None):
        self.status = status
        self.result = result
        self.traceback = traceback
        self.date_done = (
            timezone.now()
            if status in {"SUCCESS", "FAILURE", "REVOKED"}
            else None
        )
        self.save(update_fields=["status", "result", "traceback", "date_done"])


class CustomPeriodicTask(models.Model):
    """Dynamically configured recurring task."""

    name = models.CharField(max_length=128, unique=True)
    schedule = models.CharField(max_length=128)
    task_config = models.JSONField(default=dict)
    last_run_at = models.DateTimeField(null=True, blank=True)


class NotificationURL(models.Model):
    task_name = models.CharField(max_length=128)
    url = models.TextField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["task_name", "url"], name="task_notification_unique"
            )
        ]
