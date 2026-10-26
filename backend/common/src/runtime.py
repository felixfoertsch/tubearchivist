"""PostgreSQL runtime key/value and ordered queue storage."""

import json
from contextlib import contextmanager
from datetime import timedelta
from threading import Event, Thread
from uuid import uuid4

from common.models import QueueEntry, RuntimeQueueState, RuntimeValue
from django.db import transaction
from django.db.models import Q
from django.utils import timezone


class RuntimeStore:
    """Persist expiring or durable key/value messages."""

    def set_message(
        self,
        key: str,
        message: dict | str,
        expire: bool | int = False,
        save: bool = False,
    ) -> None:
        if not isinstance(message, (dict, str)):
            raise TypeError("runtime message must be dict or str")
        value = json.dumps(message) if isinstance(message, dict) else message
        expires_at = None
        if expire:
            seconds = 20 if isinstance(expire, bool) else expire
            expires_at = timezone.now() + timedelta(seconds=seconds)
        RuntimeValue.objects.update_or_create(
            key=key, defaults={"value": value, "expires_at": expires_at}
        )

    def bg_save(self) -> None:
        """Not required: each ORM write commits transactionally."""

    @staticmethod
    def cleanup_expired(limit: int = 1000) -> int:
        """Bound retention of expired progress and notification records."""
        keys = list(
            RuntimeValue.objects.filter(expires_at__lte=timezone.now())
            .order_by("expires_at")
            .values_list("pk", flat=True)[:limit]
        )
        deleted, _ = RuntimeValue.objects.filter(
            pk__in=keys, expires_at__lte=timezone.now()
        ).delete()
        return deleted

    @staticmethod
    def _get_value(key: str) -> str | None:
        now = timezone.now()
        value = (
            RuntimeValue.objects.filter(key=key)
            .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
            .values_list("value", flat=True)
            .first()
        )
        if value is None:
            RuntimeValue.objects.filter(key=key, expires_at__lte=now).delete()
        return value

    def get_message_str(self, key: str) -> str | None:
        return self._get_value(key)

    def get_message_dict(self, key: str) -> dict:
        value = self._get_value(key)
        return json.loads(value) if value else {}

    def get_message(self, key: str) -> dict | None:
        value = self.get_message_dict(key)
        return value if value else {"status": False}

    def list_keys(self, query: str) -> list[str]:
        now = timezone.now()
        prefix = query.removesuffix("*")
        if "*" in prefix:
            raise ValueError("only trailing wildcard is supported")
        return list(
            RuntimeValue.objects.filter(key__startswith=prefix)
            .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
            .order_by("key")
            .values_list("key", flat=True)
        )

    def list_items(self, query: str) -> list[dict]:
        return [self.get_message_dict(key) for key in self.list_keys(query)]

    def del_message(self, key: str, save: bool = False) -> bool:
        deleted, _ = RuntimeValue.objects.filter(key=key).delete()
        return bool(deleted)


class RuntimeQueue:
    """Ordered deduplicating queue with fenced, expiring worker claims."""

    CLAIM_SECONDS = 300

    def __init__(self, queue_name: str):
        self.key = queue_name
        self._claims: dict[str, object] = {}

    def get_all(self) -> list[str]:
        return list(
            QueueEntry.objects.filter(queue=self.key)
            .order_by("position")
            .values_list("value", flat=True)
        )

    def length(self) -> int:
        return QueueEntry.objects.filter(queue=self.key).count()

    def get_rank(self, element: str) -> int | None:
        entry = (
            QueueEntry.objects.filter(queue=self.key, value=element)
            .values_list("position", flat=True)
            .first()
        )
        if entry is None:
            return None
        return QueueEntry.objects.filter(
            queue=self.key, position__lt=entry
        ).count()

    @transaction.atomic
    def add(self, to_add: str) -> None:
        if to_add:
            self.add_list([to_add])

    @transaction.atomic
    def add_list(self, to_add: list[str]) -> None:
        if not to_add:
            return
        RuntimeQueueState.objects.get_or_create(queue=self.key)
        state = RuntimeQueueState.objects.select_for_update().get(
            queue=self.key
        )
        for value in to_add:
            if (
                not value
                or QueueEntry.objects.filter(
                    queue=self.key, value=value
                ).exists()
            ):
                continue
            QueueEntry.objects.create(
                queue=self.key, value=value, position=state.next_position
            )
            state.next_position += 1
        state.save(update_fields=["next_position"])

    def max_score(self) -> int | None:
        return (
            QueueEntry.objects.filter(queue=self.key)
            .order_by("-position")
            .values_list("position", flat=True)
            .first()
        )

    @transaction.atomic
    def get_next(self, eligible=None) -> tuple[str | None, int | None]:
        now = timezone.now()
        candidates = (
            QueueEntry.objects.select_for_update(skip_locked=True)
            .filter(queue=self.key)
            .filter(Q(claimed_until__isnull=True) | Q(claimed_until__lte=now))
        )
        if eligible is not None:
            candidates = candidates.filter(value__in=eligible)
        entry = candidates.order_by("position").first()
        if entry is None:
            return None, None
        owner = uuid4()
        entry.claimed_by = owner
        entry.claimed_until = now + timedelta(seconds=self.CLAIM_SECONDS)
        entry.save(update_fields=["claimed_by", "claimed_until"])
        self._claims[entry.value] = owner
        return entry.value, entry.position

    @contextmanager
    def keepalive(self, value: str):
        """Renew long claims; reject acknowledgment after lease loss."""
        from django.db import close_old_connections

        stopped = Event()
        lost = Event()

        def heartbeat():
            try:
                while not stopped.wait(self.CLAIM_SECONDS / 3):
                    close_old_connections()
                    if not self.renew(value):
                        lost.set()
                        return
            except Exception:
                lost.set()
            finally:
                close_old_connections()

        thread = Thread(target=heartbeat, daemon=True)
        thread.start()
        try:
            yield
            if lost.is_set() or not self.renew(value):
                raise RuntimeError("Queue claim expired during processing")
        finally:
            stopped.set()
            thread.join(timeout=5)

    def renew(self, value: str) -> bool:
        if value not in self._claims:
            return False
        now = timezone.now()
        renewed = QueueEntry.objects.filter(
            queue=self.key,
            value=value,
            claimed_by=self._claims.get(value),
            claimed_until__gt=now,
        ).update(claimed_until=now + timedelta(seconds=self.CLAIM_SECONDS))
        if not renewed:
            self._claims.pop(value, None)
        return bool(renewed)

    def release(self, value: str) -> bool:
        if value not in self._claims:
            return False
        released = QueueEntry.objects.filter(
            queue=self.key,
            value=value,
            claimed_by=self._claims.get(value),
        ).update(claimed_by=None, claimed_until=None)
        self._claims.pop(value, None)
        return bool(released)

    def ack(self, value: str) -> bool:
        if value not in self._claims:
            return False
        deleted, _ = QueueEntry.objects.filter(
            queue=self.key,
            value=value,
            claimed_by=self._claims.get(value),
            claimed_until__gt=timezone.now(),
        ).delete()
        self._claims.pop(value, None)
        return bool(deleted)

    def discard(self, value: str) -> bool:
        """Explicit domain/user deletion, not worker acknowledgment."""
        deleted, _ = QueueEntry.objects.filter(
            queue=self.key, value=value
        ).delete()
        self._claims.pop(value, None)
        return bool(deleted)

    @transaction.atomic
    def clear(self) -> None:
        RuntimeQueueState.objects.get_or_create(queue=self.key)
        state = RuntimeQueueState.objects.select_for_update().get(
            queue=self.key
        )
        QueueEntry.objects.filter(queue=self.key).delete()
        state.next_position = 1
        state.save(update_fields=["next_position"])
