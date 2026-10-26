"""Playlist entries retain unavailable remote members on local matching."""

import pytest
from channel.models import Channel
from common.src.domain import save_playlist, save_video
from playlist.models import PlaylistEntry
from playlist.src.index import YoutubePlaylist
from video.models import Video

pytestmark = pytest.mark.django_db(transaction=True)


def test_match_local_retains_unavailable_remote_playlist_entry():
    channel = Channel.objects.create(
        id="playlist-membership-channel", name="C"
    )
    save_video(
        {
            "youtube_id": "playlist-downloaded-video",
            "channel": {"channel_id": channel.pk},
            "title": "Available",
            "vid_type": "videos",
        }
    )
    save_playlist(
        {
            "playlist_id": "playlist-retain-membership",
            "playlist_name": "Remote list",
            "playlist_type": "regular",
            "playlist_entries": [
                {
                    "youtube_id": "playlist-downloaded-video",
                    "idx": 0,
                    "title": "Old title",
                },
                {
                    "youtube_id": "remote-only-video",
                    "idx": 1,
                    "title": "Remote title",
                },
            ],
        }
    )

    playlist = YoutubePlaylist("playlist-retain-membership")
    playlist.get_from_db()
    playlist.match_local()

    entries = list(
        PlaylistEntry.objects.filter(playlist_id=playlist.youtube_id)
        .order_by("position")
        .values_list("video_id", flat=True)
    )
    assert entries == ["playlist-downloaded-video", "remote-only-video"]
    assert "remote-only-video" not in Video.objects.values_list(
        "pk", flat=True
    )
