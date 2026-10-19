"""Wire-format edge cases consumed by both frontends."""

from common.serializers import NotificationSerializer, PaginationSerializer


def test_empty_download_pagination_serializes_false_as_zero():
    response = PaginationSerializer(
        {
            "current_page": 0,
            "last_page": False,
            "max_hits": False,
            "next_pages": [],
            "page_from": 0,
            "page_size": 50,
            "params": "filter=pending",
            "prev_pages": None,
            "total_hits": 0,
        }
    ).data
    assert response["last_page"] == 0
    assert type(response["last_page"]) is int
    assert response["prev_pages"] is None
    assert response["next_pages"] == []


def test_notification_serializes_no_command_as_null():
    response = NotificationSerializer(
        {
            "id": "test",
            "title": "Test",
            "group": "download",
            "api_start": False,
            "api_stop": True,
            "level": "info",
            "messages": [],
            "progress": 0,
            "command": None,
        }
    ).data
    assert response["command"] is None
    assert response["progress"] == 0


def test_notification_exposes_active_download_video():
    base = {
        "id": "test",
        "title": "Downloading",
        "group": "download:run",
        "api_start": True,
        "api_stop": True,
        "level": "info",
        "messages": [],
    }
    assert "youtube_id" not in NotificationSerializer(base).data
    data = NotificationSerializer({**base, "youtube_id": "abc"}).data
    assert data["youtube_id"] == "abc"
