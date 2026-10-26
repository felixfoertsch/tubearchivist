"""PostgreSQL-backed ephemeral runtime values and durable work queues."""

from django.db import models


class RuntimeValue(models.Model):
    key = models.TextField(primary_key=True)
    value = models.TextField()
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)


class RuntimeQueueState(models.Model):
    queue = models.TextField(primary_key=True)
    next_position = models.BigIntegerField(default=1)


class QueueEntry(models.Model):
    queue = models.TextField()
    value = models.TextField()
    position = models.BigIntegerField()
    claimed_until = models.DateTimeField(null=True, blank=True, db_index=True)
    claimed_by = models.UUIDField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["queue", "value"], name="runtime_queue_value_unique"
            )
        ]
        indexes = [
            models.Index(
                fields=["queue", "position"], name="runtime_queue_position"
            )
        ]
