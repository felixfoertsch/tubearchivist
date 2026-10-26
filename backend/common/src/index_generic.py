"""
functionality:
- generic base class to inherit from for video, channel and playlist
"""

import math

from appsettings.src.config import AppConfig
from channel.models import Channel
from common.src.domain import (
    channel_data,
    playlist_data,
    save_channel,
    save_playlist,
    save_video,
    video_data,
)
from download.src.yt_dlp_base import YtWrap
from playlist.models import Playlist
from rest_framework.exceptions import ValidationError
from user.src.user_config import UserConfig
from video.models import Video


class YouTubeItem:
    """base class for youtube"""

    index_name = ""
    yt_base = ""
    yt_obs: dict[str, bool | str] = {
        "skip_download": True,
        "noplaylist": True,
    }

    def __init__(self, youtube_id):
        self.youtube_id = youtube_id
        self.model = {
            "ta_channel": Channel,
            "ta_video": Video,
            "ta_playlist": Playlist,
        }[self.index_name]
        self.to_data = {
            "ta_channel": channel_data,
            "ta_video": video_data,
            "ta_playlist": playlist_data,
        }[self.index_name]
        self.save_data = {
            "ta_channel": save_channel,
            "ta_video": save_video,
            "ta_playlist": save_playlist,
        }[self.index_name]
        self.config = AppConfig().config
        self.error = None
        self.youtube_meta = False
        self.json_data = False

    def build_yt_url(self):
        """build youtube url"""
        return self.yt_base + self.youtube_id

    def get_from_youtube(self, obs_overwrite: dict | None = None):
        """use yt-dlp to get meta data from youtube"""
        print(f"{self.youtube_id}: get metadata from youtube")
        obs_request = self.yt_obs.copy()
        if self.config["downloads"]["extractor_lang"]:
            langs = self.config["downloads"]["extractor_lang"]
            langs_list = [i.strip() for i in langs.split(",")]
            obs_request["extractor_args"] = {
                "youtube": {"lang": langs_list}
            }  # type: ignore

        if obs_overwrite:
            obs_request.update(obs_overwrite)

        url = self.build_yt_url()
        self.youtube_meta, self.error = YtWrap(
            obs_request, self.config
        ).extract(url)

    def get_from_db(self, print_error: bool = True) -> None:
        """Load domain object as existing wire shape."""
        obj = self.model.objects.filter(pk=self.youtube_id).first()
        self.json_data = self.to_data(obj) if obj else False

    def save_to_db(self):
        """Persist current wire data through domain conversion helper."""
        self.save_data(self.json_data)

    def deactivate(self):
        """deactivate document in es"""
        print(f"{self.youtube_id}: deactivate document")
        self.model.objects.filter(pk=self.youtube_id).update(active=False)

    def delete_from_db(self):
        """Delete item and dependent rows."""
        print(f"{self.youtube_id}: delete from db")
        self.model.objects.filter(pk=self.youtube_id).delete()


class Pagination:
    """
    figure out the pagination based on page size and total_hits
    """

    MAX_RESULTS = 10000

    def __init__(self, request):
        self.request = request
        self.page_get = False
        self.params = False
        self.get_params()
        self.page_size = self.get_page_size()
        self.pagination = self.first_guess()

    def get_params(self):
        """process url query parameters"""
        query_dict = self.request.GET.copy()
        self.page_get = int(query_dict.get("page", 0))

        _ = query_dict.pop("page", False)
        self.params = query_dict.urlencode()

    def get_page_size(self):
        """get default or user modified page_size"""
        return UserConfig(self.request.user.id).get_value("page_size")

    def first_guess(self):
        """build first guess before api call"""
        page_get = self.page_get
        page_from = 0
        if page_get in [0, 1]:
            prev_pages = None
        elif page_get > 1:
            page_from = (page_get - 1) * self.page_size
            prev_pages = [
                i for i in range(page_get - 1, page_get - 6, -1) if i > 1
            ]
            prev_pages.reverse()

        if page_from >= self.MAX_RESULTS:
            raise ValidationError(
                f"Page exceeds the {self.MAX_RESULTS}-result window."
            )

        pagination = {
            "page_size": min(self.page_size, self.MAX_RESULTS - page_from),
            "page_from": page_from,
            "prev_pages": prev_pages,
            "current_page": page_get,
            "max_hits": False,
            "params": self.params,
        }

        return pagination

    def validate(self, total_hits):
        """validate pagination with total_hits after making api call"""
        page_get = self.page_get
        max_pages = math.ceil(
            min(total_hits, self.MAX_RESULTS) / self.page_size
        )
        if total_hits >= self.MAX_RESULTS:
            # es caps the reported total at the result limit
            self.pagination["max_hits"] = True

        if page_get < max_pages and max_pages > 1:
            self.pagination["last_page"] = max_pages
        else:
            self.pagination["last_page"] = False
        next_pages = [
            i for i in range(page_get + 1, page_get + 6) if 1 < i < max_pages
        ]

        self.pagination["next_pages"] = next_pages
        self.pagination["total_hits"] = total_hits
