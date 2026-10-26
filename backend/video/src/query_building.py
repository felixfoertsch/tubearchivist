"""Build PostgreSQL video-list querysets and validate legacy query options."""

from common.src.runtime import RuntimeStore
from django.db.models import Case, F, IntegerField, When
from django.db.models.expressions import RawSQL
from playlist.models import Playlist, PlaylistEntry
from video.models import Video
from video.src.constants import OrderEnum, SortEnum, VideoTypeEnum, WatchedEnum


class QueryBuilder:
    def __init__(self, user_id: int, **kwargs):
        self.user_id = user_id
        self.request_params = kwargs

    def build_data(self):
        return {"queryset": self.build_query()}

    def build_query(self):
        params = self.request_params
        queryset = Video.objects.select_related("channel").all()
        queryset = self._filter_channel(queryset, params)
        queryset = self._filter_playlist(queryset, params)
        queryset = self._filter_watch(queryset, params)
        queryset = self._filter_type(queryset, params)
        queryset = self._filter_height(queryset, params)
        return self._sort(queryset, params)

    @staticmethod
    def _filter_channel(queryset, params):
        if params.get("channel"):
            return queryset.filter(channel_id=params["channel"])
        return queryset

    @staticmethod
    def _filter_playlist(queryset, params):
        if not params.get("playlist"):
            return queryset
        playlist = Playlist.objects.filter(pk=params["playlist"]).first()
        if playlist is None:
            return queryset.none()
        entries = PlaylistEntry.objects.filter(playlist_id=params["playlist"])
        ids = list(
            entries.order_by("position").values_list("video_id", flat=True)
        )
        ordering = Case(
            *[
                When(pk=video_id, then=index)
                for index, video_id in enumerate(ids)
            ],
            output_field=IntegerField(),
        )
        return queryset.filter(pk__in=ids).order_by(ordering, "pk")

    def _filter_watch(self, queryset, params):
        if not params.get("watch"):
            return queryset
        watch = self.parse_watch(params["watch"])
        if watch == "watched":
            return queryset.filter(watched=True)
        if watch == "unwatched":
            return queryset.filter(watched=False)
        ids = [
            item.get("youtube_id")
            for item in RuntimeStore().list_items(f"{self.user_id}:progress:")
            if item.get("youtube_id") and not item.get("watched")
        ]
        return queryset.filter(pk__in=ids) if ids else queryset.none()

    @classmethod
    def _filter_type(cls, queryset, params):
        if params.get("type"):
            return queryset.filter(video_type=cls.parse_type(params["type"]))
        return queryset

    @staticmethod
    def _filter_height(queryset, params):
        if not params.get("height"):
            return queryset
        try:
            height = int(params["height"])
        except (TypeError, ValueError) as err:
            raise ValueError("height must be an integer") from err
        from django.db.models import Exists, OuterRef

        matches = Video.objects.filter(
            pk=OuterRef("pk"), metadata__streams__contains=[{"height": height}]
        )
        return queryset.annotate(_has_height=Exists(matches)).filter(
            _has_height=True
        )

    def _sort(self, queryset, params):
        if not params.get("sort") or params.get("playlist"):
            return queryset
        sort = self.parse_sort()
        field, direction = next(iter(sort["sort"][0].items()))
        lookup = {
            "published": "published",
            "date_downloaded": "downloaded_at",
            "stats.view_count": "view_count",
            "stats.like_count": "like_count",
            "player.duration": "duration",
            "media_size": "media_size",
            "streams.width": "metadata__streams__width",
            "streams.height": "metadata__streams__height",
        }[field]
        if field in {"streams.width", "streams.height"}:
            dimension = field.removeprefix("streams.")
            aggregate = "MIN" if direction["order"] == "asc" else "MAX"
            queryset = queryset.annotate(
                _stream_dimension=RawSQL(
                    "(SELECT " + aggregate + "((stream->>%s)::numeric) "
                    "FROM jsonb_array_elements("
                    "video_video.metadata->'streams') AS stream "
                    "WHERE stream->>%s ~ '^[0-9]+$')",
                    [dimension, dimension],
                )
            )
            dimension_order = F("_stream_dimension")
            return queryset.order_by(
                (
                    dimension_order.asc(nulls_last=True)
                    if direction["order"] == "asc"
                    else dimension_order.desc(nulls_last=True)
                ),
                "pk",
            )
        return queryset.order_by(
            ("" if direction["order"] == "asc" else "-") + lookup, "pk"
        )

    @staticmethod
    def parse_watch(watch):
        if watch not in WatchedEnum.values():
            raise ValueError(f"'{watch}' not in {WatchedEnum.values()}")
        return watch

    @staticmethod
    def parse_type(video_type):
        if video_type not in VideoTypeEnum.values_known():
            raise ValueError(
                f"'{video_type}' not in {VideoTypeEnum.values_known()}"
            )
        return video_type

    def parse_sort(self):
        sort = self.request_params.get("sort")
        try:
            sort = SortEnum[sort.upper()].value
        except (KeyError, AttributeError) as error:
            raise ValueError(f"'{sort}' not in SortEnum") from error
        order = self.request_params.get("order", "desc")
        if order not in OrderEnum.values():
            raise ValueError(f"'{order}' not in {OrderEnum.values()}")
        return {"sort": [{sort: {"order": order}}]}
