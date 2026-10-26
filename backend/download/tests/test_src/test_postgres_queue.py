"""PostgreSQL queue and pending-domain integration."""

import pytest
from common.src.domain import download_data, save_download
from common.src.runtime import QueueEntry, RuntimeQueue
from download.models import Download
from download.src.queue_interact import PendingInteract
from download.src.yt_dlp_handler import VideoDownloader

pytestmark = pytest.mark.django_db(transaction=True)


class TaskStub:
    def __init__(self, task_id, retries):
        self.request = type(
            "Request", (), {"id": task_id, "retries": retries}
        )()


def test_retry_clears_only_errors_from_same_task():
    queue = RuntimeQueue("download:pending")
    queue.clear()
    retried = "same-task-retry-video"
    unrelated = "other-task-error-video"
    save_download(
        {
            "youtube_id": retried,
            "status": "pending",
            "vid_type": "videos",
            "message": "transient failure",
            "retry_task_id": "task-1",
        }
    )
    save_download(
        {
            "youtube_id": unrelated,
            "status": "pending",
            "vid_type": "videos",
            "message": "historical failure",
            "retry_task_id": "task-2",
        }
    )
    queue.add(retried)
    queue.add(unrelated)

    VideoDownloader(task=TaskStub("task-1", retries=1))._clear_retry_errors()

    assert "message" not in Download.objects.get(pk=retried).metadata
    assert "retry_task_id" not in Download.objects.get(pk=retried).metadata
    assert Download.objects.get(pk=unrelated).metadata["message"] == (
        "historical failure"
    )
    assert (
        VideoDownloader(task=TaskStub("task-1", retries=0))._get_next(
            auto_only=False
        )["youtube_id"]
        == retried
    )


def test_explicit_unignore_requeues_and_user_delete_discards_claimed_entry():
    identifier = "postgres-unignore-video"
    queue = RuntimeQueue("download:pending")
    queue.clear()
    save_download(
        {"youtube_id": identifier, "status": "ignore", "vid_type": "videos"}
    )
    assert not QueueEntry.objects.filter(
        queue=queue.key, value=identifier
    ).exists()

    PendingInteract(identifier, "pending").update_status()
    assert QueueEntry.objects.filter(
        queue=queue.key, value=identifier
    ).exists()
    assert queue.get_next()[0] == identifier
    PendingInteract(identifier).delete_item()
    assert not QueueEntry.objects.filter(
        queue=queue.key, value=identifier
    ).exists()
    assert not Download.objects.filter(pk=identifier).exists()


def test_single_ignore_discards_queue_entry():
    identifier = "postgres-single-ignore-video"
    queue = RuntimeQueue("download:pending")
    queue.clear()
    save_download(
        {"youtube_id": identifier, "status": "pending", "vid_type": "videos"}
    )
    queue.add(identifier)
    PendingInteract(identifier, "ignore").update_status()
    assert Download.objects.get(pk=identifier).status == "ignore"
    assert not QueueEntry.objects.filter(
        queue=queue.key, value=identifier
    ).exists()


def test_pending_rows_keep_errors_and_ack_only_after_success():
    identifier = "postgres-queue-video"
    queue = RuntimeQueue("download:pending")
    queue.clear()
    Download.objects.filter(pk=identifier).delete()

    save_download(
        {
            "youtube_id": identifier,
            "channel_id": "channel",
            "title": "Queued",
            "status": "pending",
            "vid_type": "videos",
            "timestamp": 100,
            "message": "retryable error",
        }
    )
    queue.add(identifier)
    assert (
        download_data(Download.objects.get(pk=identifier))["message"]
        == "retryable error"
    )
    assert queue.get_next() == (identifier, 1)

    PendingInteract(identifier, "priority").update_status()
    item = Download.objects.get(pk=identifier)
    assert item.status == "pending"
    assert item.metadata["auto_start"] is True
    assert "message" not in item.metadata
    assert queue.ack(identifier) is True
    assert not QueueEntry.objects.filter(
        queue="download:pending", value=identifier
    ).exists()

    PendingInteract(identifier).delete_item()
    assert not Download.objects.filter(pk=identifier).exists()
