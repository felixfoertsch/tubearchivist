"""PostgreSQL comment refresh updates remain atomic."""

from unittest.mock import patch

import pytest
from channel.models import Channel
from common.src.domain import save_video
from video.models import Video, VideoComments
from video.src.comments import Comments

pytestmark = pytest.mark.django_db(transaction=True)


def test_failed_comment_count_update_rolls_back_comment_replacement():
    channel = Channel.objects.create(
        id="comment-atomic-channel", name="Channel"
    )
    video = save_video(
        {
            "youtube_id": "comment-atomic-video",
            "channel": {"channel_id": channel.pk},
            "title": "Video",
            "vid_type": "videos",
            "comment_count": 2,
        }
    )
    replies = [
        {"comment_id": "parent", "comment_parent": "root"},
        {"comment_id": "reply", "comment_parent": "parent"},
    ]
    saved = VideoComments.objects.create(
        video=video, comments=replies, last_refresh=10
    )
    comment = Comments(video.pk)
    comment.json_data = {
        "comment_comments": [{"comment_id": "replacement"}],
        "comment_last_refresh": 20,
    }

    with patch.object(Video, "save", side_effect=RuntimeError("write failed")):
        with pytest.raises(RuntimeError, match="write failed"):
            comment.upload_comments()

    saved.refresh_from_db()
    video.refresh_from_db()
    assert saved.comments == replies
    assert saved.last_refresh == 10
    assert video.metadata["comment_count"] == 2
