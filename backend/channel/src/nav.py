"""Build channel navigation from domain rows."""

from download.models import Download
from playlist.models import Playlist
from video.models import Video


class ChannelNav:
    """Get all navigation items."""

    def __init__(self, channel_id):
        self.channel_id = channel_id

    def get_nav(self):
        return {
            "has_pending": Download.objects.filter(
                channel_id=self.channel_id, status="pending"
            ).exists(),
            "has_ignored": Download.objects.filter(
                channel_id=self.channel_id, status="ignore"
            ).exists(),
            "has_playlists": Playlist.objects.filter(
                channel_id=self.channel_id
            ).exists(),
            "has_videos": Video.objects.filter(
                channel_id=self.channel_id, video_type="videos"
            ).exists(),
            "has_streams": Video.objects.filter(
                channel_id=self.channel_id, video_type="streams"
            ).exists(),
            "has_shorts": Video.objects.filter(
                channel_id=self.channel_id, video_type="shorts"
            ).exists(),
        }
