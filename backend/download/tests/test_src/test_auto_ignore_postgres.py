"""Auto-ignore updates retained pending row without invalidating its claim."""

import pytest
from channel.models import Channel
from common.src.domain import save_download
from common.src.runtime import QueueEntry, RuntimeQueue
from download.models import Download
from download.src.yt_dlp_handler import VideoDownloader

pytestmark = pytest.mark.django_db(transaction=True)


def test_auto_ignore_acks_claim_and_persists_ignore_without_losing_keepalive():
    identifier = "auto-ignore-claimed-video"
    channel_id = "auto-ignore-channel"
    Channel.objects.create(
        id=channel_id,
        name="Channel",
        overrides={"auto_ignore_filter": "Podcast"},
    )
    save_download(
        {
            "youtube_id": identifier,
            "channel_id": channel_id,
            "title": "Podcast episode",
            "status": "pending",
            "vid_type": "videos",
        }
    )
    queue = RuntimeQueue("download:pending")
    queue.discard(identifier)
    queue.add(identifier)

    downloader = object.__new__(VideoDownloader)
    downloader.task = None
    downloader._notify = lambda *_args, **_kwargs: None
    downloader.pending_queue = queue
    downloader.config = {"downloads": {"add_metadata": False}}
    downloader._reset_auto = lambda: None

    def next_item(_auto_only):
        data = VideoDownloader._get_next(downloader, _auto_only)
        return data

    downloader._get_next = next_item

    from unittest.mock import patch

    with patch(
        "download.src.yt_dlp_handler.DownloadPostProcess"
    ) as postprocess:
        assert downloader.run_queue() == (0, 0)

    assert Download.objects.get(pk=identifier).status == "ignore"
    assert not QueueEntry.objects.filter(
        queue=queue.key, value=identifier
    ).exists()
    postprocess.return_value.run.assert_called_once_with()
