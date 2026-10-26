"""PostgreSQL runtime-store expiry and queue contracts."""

import os
from datetime import timedelta

import django
import pytest

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from common.models import (  # noqa: E402
    QueueEntry,
    RuntimeQueueState,
    RuntimeValue,
)
from common.src.runtime import RuntimeQueue, RuntimeStore  # noqa: E402
from django.utils import timezone  # noqa: E402


@pytest.mark.django_db(transaction=True)
def test_store_json_string_expiry_and_durable_values():
    RuntimeValue.objects.all().delete()
    store = RuntimeStore()
    store.set_message("runtime:test:json", {"ok": True})
    store.set_message("runtime:test:text", "plain")
    store.set_message("runtime:test:expired", "old", expire=1)
    RuntimeValue.objects.filter(key="runtime:test:expired").update(
        expires_at=timezone.now() - timedelta(seconds=1)
    )

    assert store.get_message_dict("runtime:test:json") == {"ok": True}
    assert store.get_message_str("runtime:test:text") == "plain"
    assert store.get_message_str("runtime:test:expired") is None
    assert store.list_keys("runtime:test:*") == [
        "runtime:test:json",
        "runtime:test:text",
    ]
    with pytest.raises(ValueError, match="only trailing wildcard"):
        store.list_keys("runtime:*:json")
    assert store.del_message("runtime:test:json") is True


@pytest.mark.django_db(transaction=True)
def test_queue_order_duplicates_ranks_claim_recovery_and_ack():
    queue_name = "runtime:test:queue"
    QueueEntry.objects.filter(queue=queue_name).delete()
    RuntimeQueueState.objects.filter(queue=queue_name).delete()
    queue = RuntimeQueue(queue_name)

    queue.add_list(["one", "two", "one", "three"])
    assert queue.get_all() == ["one", "two", "three"]
    assert queue.length() == 3
    assert queue.get_rank("two") == 1
    assert queue.max_score() == 3
    stranger = RuntimeQueue(queue_name)
    assert stranger.ack("one") is False
    assert stranger.release("one") is False
    assert stranger.renew("one") is False
    assert queue.length() == 3
    assert stranger.get_next(eligible=["absent"]) == (None, None)

    assert queue.get_next() == ("one", 1)
    first_owner = queue._claims["one"]
    stale_worker = RuntimeQueue(queue_name)
    assert stale_worker.get_next() == ("two", 2)
    assert queue.renew("one") is True
    assert queue.get_next() == ("three", 3)
    assert queue.get_next() == (None, None)

    QueueEntry.objects.filter(queue=queue_name, value="one").update(
        claimed_until=timezone.now() - timedelta(seconds=1)
    )
    reclaim_worker = RuntimeQueue(queue_name)
    assert reclaim_worker.get_next() == ("one", 1)
    assert reclaim_worker._claims["one"] != first_owner
    assert queue.ack("one") is False
    assert reclaim_worker.ack("one") is True
    assert queue.get_all() == ["two", "three"]
    queue.clear()
    assert queue.length() == 0
    assert queue.get_rank("fresh") is None
    queue.add("fresh")
    assert queue.get_next() == ("fresh", 1)
    with queue.keepalive("fresh"):
        assert QueueEntry.objects.get(
            queue=queue_name, value="fresh"
        ).claimed_by
    assert queue.ack("fresh") is True

    queue.add("lost")
    assert queue.get_next()[0] == "lost"
    with pytest.raises(RuntimeError, match="expired"):
        with queue.keepalive("lost"):
            QueueEntry.objects.filter(queue=queue_name, value="lost").update(
                claimed_until=timezone.now() - timedelta(seconds=1)
            )
    assert queue.ack("lost") is False


@pytest.mark.django_db
def test_expired_runtime_cleanup_is_bounded_and_preserves_live_values():
    for number in range(3):
        RuntimeStore().set_message(f"expired:{number}", {}, expire=-1)
    RuntimeStore().set_message("permanent", {})
    RuntimeStore().set_message("live", {}, expire=60)
    assert RuntimeStore.cleanup_expired(limit=2) == 2
    assert RuntimeValue.objects.filter(key__startswith="expired:").count() == 1
    assert (
        RuntimeValue.objects.filter(key__in=["permanent", "live"]).count() == 2
    )
    assert RuntimeStore.cleanup_expired() == 1


@pytest.mark.django_db(transaction=True)
def test_keepalive_renews_claim_on_independent_database_connection(
    monkeypatch,
):
    from threading import Event

    queue = RuntimeQueue("runtime:test:heartbeat")
    queue.add("slow")
    assert queue.get_next()[0] == "slow"
    renewed = Event()
    renew = queue.renew

    def record_renew(value):
        result = renew(value)
        if result:
            renewed.set()
        return result

    monkeypatch.setattr(queue, "CLAIM_SECONDS", 3)
    monkeypatch.setattr(queue, "renew", record_renew)
    with queue.keepalive("slow"):
        assert renewed.wait(timeout=5), "Heartbeat did not renew claim"
    assert queue.ack("slow") is True
