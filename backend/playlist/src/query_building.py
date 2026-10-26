"""Build native playlist list queryset."""

from playlist.models import Playlist
from playlist.src.constants import PlaylistTypesEnum


class QueryBuilder:
    def __init__(self, **kwargs):
        self.request_params = kwargs

    def build_data(self):
        return self.build_query()

    def build_query(self):
        queryset = Playlist.objects.all()
        if channel := self.request_params.get("channel"):
            queryset = queryset.filter(channel_id=channel)
        subscribed = self.request_params.get("subscribed")
        if subscribed is not None:
            queryset = queryset.filter(subscribed=subscribed)
        if playlist_type := self.request_params.get("type"):
            playlist_type = self.parse_type(playlist_type)
            queryset = queryset.filter(playlist_type=playlist_type)
        return queryset.order_by("name", "pk")

    @staticmethod
    def parse_type(playlist_type):
        try:
            return PlaylistTypesEnum[playlist_type.upper()].value
        except KeyError as err:
            raise ValueError(
                f"'{playlist_type}' not in PlaylistTypesEnum"
            ) from err
