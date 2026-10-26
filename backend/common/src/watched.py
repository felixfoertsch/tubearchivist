"""
functionality:
- handle watched state for videos, channels and playlists
"""

from datetime import datetime

from common.src.runtime import RuntimeStore
from common.src.urlparser import Parser
from playlist.models import PlaylistEntry
from video.models import Video


class WatchState:
    """handle watched checkbox for videos and channels"""

    def __init__(self, youtube_id: str, is_watched: bool, user_id: int):
        self.youtube_id = youtube_id
        self.is_watched = is_watched
        self.user_id = user_id
        self.stamp = int(datetime.now().timestamp())

    def change(self):
        """change watched state of item(s)"""
        print(f"{self.youtube_id}: change watched state to {self.is_watched}")
        url_type = self._dedect_type()
        if url_type == "video":
            self.change_vid_state()
            return

        if url_type == "channel":
            self.reset_channel_progress()
        if url_type == "playlist":
            self.reset_playlist_progress()

        query = Video.objects.filter(watched=not self.is_watched)
        if url_type == "channel":
            query = query.filter(channel_id=self.youtube_id)
        else:
            query = query.filter(
                id__in=PlaylistEntry.objects.filter(
                    playlist_id=self.youtube_id
                ).values("video_id")
            )
        query.update(
            watched=self.is_watched,
            watched_at=self.stamp if self.is_watched else None,
        )

    def _dedect_type(self):
        """find youtube id type"""
        url_process = Parser(self.youtube_id).parse()
        url_type = url_process[0]["type"]
        return url_type

    def change_vid_state(self):
        """change watched state of video"""
        updated = Video.objects.filter(pk=self.youtube_id).update(
            watched=self.is_watched,
            watched_at=self.stamp if self.is_watched else None,
        )
        key = f"{self.user_id}:progress:{self.youtube_id}"
        RuntimeStore().del_message(key)
        if not updated:
            raise ValueError("failed to mark video as watched")

    def reset_channel_progress(self):
        """reset channel progress positions"""
        from channel.src.index import YoutubeChannel

        videos = YoutubeChannel(self.youtube_id).get_channel_videos()
        video_ids = [i["youtube_id"] for i in videos]
        self._reset_list(video_ids)

    def reset_playlist_progress(self):
        """reset playlist progress positions"""
        from playlist.src.index import YoutubePlaylist

        videos = YoutubePlaylist(self.youtube_id).get_playlist_videos()
        video_ids = [i["youtube_id"] for i in videos]
        self._reset_list(video_ids)

    def _reset_list(self, video_ids: list[str]):
        """reset list of video ids"""
        store = RuntimeStore()
        all_ids = store.list_keys(f"{self.user_id}:progress")
        for progress_id in all_ids:
            video_id = progress_id.split(":")[-1]
            if video_id in video_ids:
                store.del_message(progress_id)
