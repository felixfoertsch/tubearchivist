"""Archived-video deletion preserves ignore queue rows without remote fetch."""

import pytest
from channel.models import Channel
from common.src.domain import save_video
from django.db.models.deletion import ProtectedError
from download.models import Download
from download.src.queue import delete_and_ignore
from video.models import Video

pytestmark = pytest.mark.django_db(transaction=True)


def archived_video(identifier="delete-local-video"):
    channel = Channel.objects.create(id="delete-local-channel", name="Channel")
    return save_video(
        {
            "youtube_id": identifier,
            "channel": {
                "channel_id": channel.pk,
                "channel_name": channel.name,
            },
            "title": "Archived title",
            "published": "2025-01-02T00:00:00+00:00",
            "vid_type": "videos",
            "player": {"duration": 125},
            "media_url": "channel/video.mp4",
            "vid_thumb_url": "https://example.invalid/thumb.jpg",
        }
    )


def test_minimal_archive_row_is_ignored_before_delete(monkeypatch):
    channel = Channel.objects.create(
        id="minimal-delete-channel", name="Channel"
    )
    video = Video.objects.create(
        id="minimal-delete-video",
        channel=channel,
        title="Minimal archived",
        video_type="videos",
    )
    deleted = []

    def delete_media(instance):
        assert Download.objects.get(pk=video.pk).status == "ignore"
        deleted.append(video.pk)
        Video.objects.filter(pk=video.pk).delete()

    monkeypatch.setattr(
        "download.src.queue.YoutubeVideo.delete_media_file", delete_media
    )
    monkeypatch.setattr(
        "download.src.queue.PendingList",
        lambda **_: pytest.fail("remote metadata fetch"),
    )
    delete_and_ignore([{"youtube_id": video.pk, "vid_type": "videos"}])

    assert deleted == [video.pk]
    ignored = Download.objects.get(pk=video.pk)
    assert ignored.status == "ignore"
    assert ignored.title == "Minimal archived"


def test_delete_creates_local_ignore_before_removing_video(monkeypatch):
    video = archived_video()
    calls = []

    def delete_media(instance):
        assert Download.objects.get(pk=video.pk).status == "ignore"
        calls.append(video.pk)
        Video.objects.filter(pk=video.pk).delete()

    monkeypatch.setattr(
        "download.src.queue.YoutubeVideo.delete_media_file", delete_media
    )
    monkeypatch.setattr(
        "download.src.queue.PendingList",
        lambda **_: pytest.fail("remote metadata fetch"),
    )

    delete_and_ignore([{"youtube_id": video.pk, "vid_type": "videos"}])

    row = Download.objects.get(pk=video.pk)
    assert calls == [video.pk]
    assert row.status == "ignore"
    assert row.title == "Archived title"
    assert row.channel_id == "delete-local-channel"
    assert row.metadata["duration"] == "2m 05s"
    assert row.metadata["vid_thumb_url"] == "https://example.invalid/thumb.jpg"
    assert not Video.objects.filter(pk=video.pk).exists()


def test_failed_video_deletion_keeps_ignore_and_archive(monkeypatch):
    video = archived_video("delete-failed-video")

    def fail_delete(_):
        raise ProtectedError("blocked", [video])

    save_ignore = Download.objects.create(
        id=video.pk,
        channel_id=video.channel_id,
        title=video.title,
        status="ignore",
        video_type="videos",
        metadata={"preserved": True},
    )
    monkeypatch.setattr(
        "download.src.queue.YoutubeVideo.delete_media_file", fail_delete
    )
    with pytest.raises(ProtectedError):
        delete_and_ignore([{"youtube_id": video.pk, "vid_type": "videos"}])

    assert Video.objects.filter(pk=video.pk).exists()
    save_ignore.refresh_from_db()
    assert save_ignore.status == "ignore"
    assert save_ignore.metadata == {"preserved": True}
