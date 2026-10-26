"""all API views for video endpoints"""

from common.serializers import ErrorResponseSerializer
from common.src.domain import video_data
from common.src.helper import calc_is_watched
from common.src.runtime import RuntimeStore
from common.src.watched import WatchState
from common.views_base import AdminWriteOnly, ApiBaseView
from drf_spectacular.utils import OpenApiResponse, extend_schema
from playlist.src.index import YoutubePlaylist
from rest_framework.response import Response
from video.models import Video, VideoComments
from video.serializers import (
    CommentItemSerializer,
    PlayerSerializer,
    PlaylistNavItemSerializer,
    VideoListQuerySerializer,
    VideoListSerializer,
    VideoProgressUpdateSerializer,
    VideoSerializer,
)
from video.src.index import YoutubeVideo
from video.src.query_building import QueryBuilder


class VideoApiListView(ApiBaseView):
    model = Video
    to_data = staticmethod(video_data)
    is_video = True
    """resolves to /api/video/
    GET: returns list of videos
    params:
    - playlist:str=<playlist-id>
    - channel:str=<channel-id>
    - watch:enum=watched|unwatched|continue
    - sort:enum=published|downloaded|views|likes|duration|filesize
    - order:enum=asc|desc
    - type:enum=videos|streams|shorts
    - height:int=px
    """

    @extend_schema(
        parameters=[VideoListQuerySerializer()],
        responses={
            200: VideoListSerializer(),
            400: OpenApiResponse(
                ErrorResponseSerializer(), description="bad request"
            ),
        },
    )
    def get(self, request):
        """get video list"""
        query_serializer = VideoListQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        validated_query = query_serializer.validated_data

        data = QueryBuilder(request.user.id, **validated_query).build_data()

        self._queryset = data["queryset"]
        self.get_document_list(request, progress_match=request.user.id)

        response_serializer = VideoListSerializer(self.response)

        return Response(response_serializer.data)


class VideoApiView(ApiBaseView):
    """resolves to /api/video/<video_id>/
    GET: returns metadata dict of video
    """

    model = Video
    to_data = staticmethod(video_data)
    is_video = True
    permission_classes = [AdminWriteOnly]

    @extend_schema(
        responses={
            200: VideoSerializer(),
            404: OpenApiResponse(
                ErrorResponseSerializer(), description="video not found"
            ),
        },
    )
    def get(self, request, video_id):
        """get video"""
        self.get_document(video_id, progress_match=request.user.id)
        if not self.response:
            error = ErrorResponseSerializer({"error": "video not found"})
            return Response(error.data, status=404)

        serializer = VideoSerializer(self.response)
        return Response(serializer.data)

    @extend_schema(
        responses={
            204: OpenApiResponse(description="video deleted"),
            404: OpenApiResponse(
                ErrorResponseSerializer(), description="video not found"
            ),
        }
    )
    def delete(self, request, video_id):
        # pylint: disable=unused-argument
        """delete video"""
        try:
            YoutubeVideo(video_id).delete_media_file()
        except FileNotFoundError:
            error = ErrorResponseSerializer({"error": "video not found"})
            return Response(error.data, status=404)

        return Response(status=204)


class VideoCommentView(ApiBaseView):
    model = VideoComments
    to_data = staticmethod(lambda obj: obj.comments)
    """resolves to /api/video/<video_id>/comment/
    handle video comments
    GET: return all comments from video with reply threads
    """

    @extend_schema(
        responses={
            200: CommentItemSerializer(),
            404: OpenApiResponse(
                ErrorResponseSerializer(), description="video not found"
            ),
        }
    )
    def get(self, request, video_id):
        """get video comments"""
        # pylint: disable=unused-argument
        comment = VideoComments.objects.filter(pk=video_id).first()
        if comment is None:
            error = ErrorResponseSerializer({"error": "video not found"})
            return Response(error.data, status=404)
        lookup = {}
        for item in comment.comments:
            lookup[item["comment_id"]] = {**item, "comment_replies": []}
        roots = []
        for item in lookup.values():
            parent = item.get("comment_parent")
            if parent == "root":
                roots.append(item)
            elif parent in lookup:
                lookup[parent]["comment_replies"].append(item)
        serializer = CommentItemSerializer(roots, many=True)

        return Response(serializer.data)


class VideoApiNavView(ApiBaseView):
    model = Video
    to_data = staticmethod(video_data)
    """resolves to /api/video/<video-id>/nav/
    GET: returns playlist nav
    """

    @extend_schema(
        responses={
            200: PlaylistNavItemSerializer(),
            404: OpenApiResponse(
                ErrorResponseSerializer(), description="video not found"
            ),
        }
    )
    def get(self, request, video_id):
        # pylint: disable=unused-argument
        """get video playlist nav"""
        self.get_document(video_id)
        if self.status_code == 404:
            error = ErrorResponseSerializer({"error": "video not found"})
            return Response(error.data, status=404)

        playlist_nav = []

        if not self.response.get("playlist"):
            return Response(playlist_nav)

        for playlist_id in self.response["playlist"]:
            playlist = YoutubePlaylist(playlist_id)
            playlist.get_from_db()
            playlist.build_nav(video_id)
            if playlist.nav:
                playlist_nav.append(playlist.nav)

        response_serializer = PlaylistNavItemSerializer(
            playlist_nav, many=True
        )

        return Response(response_serializer.data)


class VideoProgressView(ApiBaseView):
    model = Video
    to_data = staticmethod(video_data)

    """resolves to /api/video/<video_id>/progress/
    handle progress status for video
    """

    @staticmethod
    def _get_key(user_id: int, video_id: str) -> str:
        """PostgreSQL runtime key"""
        return f"{user_id}:progress:{video_id}"

    @extend_schema(
        request=VideoProgressUpdateSerializer(),
        responses={
            200: PlayerSerializer(),
            404: OpenApiResponse(
                ErrorResponseSerializer(), description="video not found"
            ),
        },
    )
    def post(self, request, video_id):
        """set video progress position in PostgreSQL runtime store"""
        data_serializer = VideoProgressUpdateSerializer(data=request.data)
        data_serializer.is_valid(raise_exception=True)
        validated_data = data_serializer.validated_data

        self.get_document(video_id)
        if self.status_code == 404:
            error = ErrorResponseSerializer({"error": "video not found"})
            return Response(error.data, status=404)

        position = validated_data["position"]
        key = self._get_key(request.user.id, video_id)
        store = RuntimeStore()
        current_progress = (
            store.get_message_dict(key) or self.response["player"]
        )

        current_progress.update({"position": position, "youtube_id": video_id})
        watched = self._check_watched(request, video_id, current_progress)
        if watched:
            expire = 60
        else:
            expire = False

        current_progress.update({"watched": watched})
        if position > 5:
            store.set_message(key, current_progress, expire=expire)

        response_serializer = PlayerSerializer(current_progress)

        return Response(response_serializer.data)

    def _check_watched(self, request, video_id, current_progress) -> bool:
        """check watched state"""
        if current_progress["watched"]:
            return True

        watched = calc_is_watched(
            current_progress["duration"], current_progress["position"]
        )
        if watched:
            WatchState(video_id, watched, request.user.id).change()

        return watched

    @extend_schema(
        responses={
            204: OpenApiResponse(description="video progress deleted"),
        }
    )
    def delete(self, request, video_id):
        """delete progress position from PostgreSQL runtime store"""
        key = self._get_key(request.user.id, video_id)
        RuntimeStore().del_message(key)

        return Response(status=204)


class VideoSimilarView(ApiBaseView):
    model = Video
    to_data = staticmethod(video_data)
    is_video = True
    """resolves to /api/video/<video-id>/similar/
    GET: return max 6 videos similar to this
    """

    @extend_schema(
        responses=VideoSerializer(many=True),
    )
    def get(self, request, video_id):
        """get similar videos"""
        source = Video.objects.filter(pk=video_id).first()
        if source is None:
            return Response([])
        from django.contrib.postgres.search import TrigramSimilarity

        self._queryset = (
            Video.objects.exclude(pk=video_id)
            .annotate(similarity=TrigramSimilarity("title", source.title))
            .filter(similarity__gt=0.1)
            .order_by("-similarity", "pk")[:6]
        )
        self.get_document_list(request, pagination=False)
        serializer = VideoSerializer(self.response["data"], many=True)
        return Response(serializer.data)
