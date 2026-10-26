"""Channel deletion removes dependent videos before protected channel row."""

import os

import pytest
from channel.models import Channel
from channel.src.index import ChannelDelete
from common.src.domain import save_video
from video.models import Video

pytestmark = pytest.mark.django_db(transaction=True)


def test_channel_delete_removes_videos_and_channel_media(
    tmp_path, monkeypatch
):
    channel_id = "delete-channel-test"
    channel = Channel.objects.create(id=channel_id, name="Delete me")
    media_dir = tmp_path / channel_id
    media_dir.mkdir()
    (media_dir / "video.mp4").write_bytes(b"media")
    video = save_video(
        {
            "youtube_id": "delete-channel-video",
            "channel": {
                "channel_id": channel_id,
                "channel_name": channel.name,
            },
            "title": "Delete me",
            "vid_type": "videos",
            "media_url": os.path.join(channel_id, "video.mp4"),
        }
    )
    monkeypatch.setattr(
        "channel.src.index.EnvironmentSettings.MEDIA_DIR", str(tmp_path)
    )

    ChannelDelete({"channel_id": channel_id}).delete()

    assert not Video.objects.filter(pk=video.pk).exists()
    assert not Channel.objects.filter(pk=channel_id).exists()
    assert not media_dir.exists()
