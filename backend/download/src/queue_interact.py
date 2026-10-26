"""Interact with ORM-backed pending downloads."""

from common.src.domain import download_data
from common.src.runtime import RuntimeQueue
from django.db import transaction
from download.models import Download


class PendingInteract:
    """Update pending download rows and their leased queue entries."""

    def __init__(self, youtube_id=False, status=False):
        self.youtube_id = youtube_id
        self.status = status
        self.queue = RuntimeQueue("download:pending")

    @transaction.atomic
    def delete_item(self, print_error: bool = True) -> None:
        Download.objects.filter(pk=self.youtube_id).delete()
        self.queue.discard(self.youtube_id)

    @transaction.atomic
    def delete_bulk(self, channel_id: str | None, vid_type: str | None):
        query = Download.objects.filter(status=self.status)
        if channel_id:
            query = query.filter(channel_id=channel_id)
        if vid_type:
            query = query.filter(video_type=vid_type)
        ids = list(query.values_list("pk", flat=True))
        query.delete()
        for item_id in ids:
            self.queue.discard(item_id)

    @transaction.atomic
    def update_bulk(
        self,
        channel_id: str | None,
        vid_type: str | None,
        new_status: str,
        error: bool | None = None,
    ):
        query = Download.objects.filter(status=self.status)
        if channel_id:
            query = query.filter(channel_id=channel_id)
        if vid_type:
            query = query.filter(video_type=vid_type)
        if error is not None:
            query = (
                query.filter(metadata__has_key="message")
                if error
                else query.exclude(metadata__has_key="message")
            )
        for item in query:
            if new_status == "priority":
                item.status = "pending"
                item.metadata["auto_start"] = True
                item.metadata.pop("message", None)
            elif new_status == "clear_error":
                item.metadata.pop("message", None)
            else:
                item.status = new_status
            item.save(update_fields=["status", "metadata"])
            if item.status == "pending" and "message" not in item.metadata:
                self.queue.add(item.pk)
            elif item.status == "ignore":
                self.queue.discard(item.pk)

    @transaction.atomic
    def update_status(self):
        item = Download.objects.filter(pk=self.youtube_id).first()
        if not item:
            return
        if self.status == "priority":
            item.status = "pending"
            item.metadata["auto_start"] = True
            item.metadata.pop("message", None)
        else:
            item.status = self.status
        item.save(update_fields=["status", "metadata"])
        if item.status == "pending" and "message" not in item.metadata:
            self.queue.add(item.pk)
        elif item.status == "ignore":
            self.queue.discard(item.pk)

    def get_item(self):
        item = Download.objects.filter(pk=self.youtube_id).first()
        return (download_data(item), 200) if item else ({}, 404)

    def get_channel(self):
        item = Download.objects.filter(channel_id=self.youtube_id).first()
        return {
            "channel_id": self.youtube_id,
            "channel_name": (
                item.metadata.get("channel_name", "NA") if item else "NA"
            ),
        }
