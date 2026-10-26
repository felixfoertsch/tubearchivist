"""Exercise caller-facing progress, sorting, and comment contracts."""

import pytest
from channel.models import Channel
from common.src.runtime import RuntimeStore
from rest_framework.test import APIClient
from user.models import Account
from video.models import Video, VideoComments
from video.src.constants import SortEnum

pytestmark = pytest.mark.django_db


@pytest.fixture
def client_video():
    account = Account.objects.create_user("reader", "password")
    client = APIClient()
    client.force_authenticate(account)
    channel = Channel.objects.create(id="channel", name="Channel")
    video = Video.objects.create(
        id="video",
        channel=channel,
        duration=100,
        metadata={"streams": []},
    )
    return client, account, video


def test_progress_post_persists_position(client_video):
    client, account, video = client_video
    response = client.post(
        f"/api/video/{video.pk}/progress/", {"position": 25}, format="json"
    )
    assert response.status_code == 200
    assert response.data["position"] == 25
    assert (
        RuntimeStore().get_message_dict(f"{account.pk}:progress:{video.pk}")[
            "position"
        ]
        == 25
    )


@pytest.mark.parametrize("sort", SortEnum.names())
def test_public_video_sort_names_are_accepted(client_video, sort):
    client, _, _ = client_video
    response = client.get("/api/video/", {"sort": sort, "order": "asc"})
    assert response.status_code == 200
    assert len(response.data["data"]) == 1


def test_comments_api_builds_nested_replies_without_duplicate_roots(
    client_video,
):
    client, _, video = client_video

    def comment(key, parent):
        return {
            "comment_id": key,
            "comment_parent": parent,
            "comment_author": "Reader",
            "comment_author_id": "reader",
            "comment_author_is_uploader": False,
            "comment_author_thumbnail": "https://example.com/avatar.jpg",
            "comment_is_favorited": False,
            "comment_likecount": 0,
            "comment_text": key,
            "comment_time_text": "today",
            "comment_timestamp": 1,
        }

    VideoComments.objects.create(
        video=video,
        comments=[
            comment("root", "root"),
            comment("reply", "root-id"),
            comment("nested", "reply"),
            comment("orphan", "missing"),
        ],
    )
    row = VideoComments.objects.get(video=video)
    row.comments[0]["comment_id"] = "root-id"
    row.save()
    response = client.get(f"/api/video/{video.pk}/comment/")
    assert response.status_code == 200
    assert [item["comment_id"] for item in response.data] == ["root-id"]
    replies = response.data[0]["comment_replies"]
    assert [item["comment_id"] for item in replies] == ["reply"]
    assert replies[0]["comment_replies"][0]["comment_id"] == "nested"
