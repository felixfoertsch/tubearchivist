"""
functionality:
- handle yt_dlp
- build options and post processor
- download video files
- move to archive
"""

import os
import re
import shutil
from datetime import datetime

from appsettings.src.config import AppConfig
from channel.src.index import YoutubeChannel
from common.src.domain import download_data, video_data
from common.src.env_settings import EnvironmentSettings
from common.src.helper import (
    get_channel_overwrites,
    get_playlists,
    ignore_filelist,
    rand_sleep,
)
from common.src.runtime import RuntimeQueue
from download.models import Download
from download.src.queue import delete_and_ignore
from download.src.yt_dlp_base import YtWrap
from playlist.models import PlaylistEntry
from playlist.src.index import YoutubePlaylist
from video.models import Video
from video.src.comments import CommentList
from video.src.constants import VideoTypeEnum
from video.src.index import YoutubeVideo, index_new_video


class DownloaderBase:
    """base class for shared config"""

    CACHE_DIR = EnvironmentSettings.CACHE_DIR
    MEDIA_DIR = EnvironmentSettings.MEDIA_DIR
    CHANNEL_QUEUE = "download:channel"
    PLAYLIST_QUEUE = "download:playlist:full"
    PLAYLIST_QUICK = "download:playlist:quick"
    VIDEO_QUEUE = "download:video"

    def __init__(self, task=None):
        self.task = task
        self.config = AppConfig().config
        self.channel_overwrites = get_channel_overwrites()
        self.now = int(datetime.now().timestamp())


class VideoDownloader(DownloaderBase):
    """handle the video download functionality"""

    def __init__(self, task=False):
        super().__init__(task)
        self.obs = False
        self.pending_queue = RuntimeQueue("download:pending")
        self.active_lease = None
        self._build_obs()

    def run_queue(self, auto_only=False) -> tuple[int, int]:
        """Process leased downloads until no queue items remain."""
        downloaded = 0
        failed = 0
        self._clear_retry_errors()
        while True:
            video_data = self._get_next(auto_only)
            if not video_data:
                break
            youtube_id = video_data["youtube_id"]
            stopped = bool(self.task and self.task.is_stopped())
            with self.pending_queue.keepalive(youtube_id):
                if stopped:
                    success, ignored = False, False
                elif self._auto_ignore(video_data):
                    success, ignored = False, True
                else:
                    if downloaded > 0:
                        rand_sleep(self.config)
                    success = self._process_queued_video(video_data)
                    ignored = False
                    failed += not success
            if stopped or not success and not ignored:
                self.pending_queue.release(youtube_id)
                self.active_lease = None
                break
            self.pending_queue.ack(youtube_id)
            self.active_lease = None
            downloaded += success

        # Failed or stopped batches cannot grant destructive reconciliation.
        if (
            not failed
            and not (self.task and self.task.is_stopped())
            and downloaded
        ):
            from download.src.rolling_window import reconcile_windows

            reconcile_windows(self.config, self.task)
        # Postprocessing can prune media; run only after a clean queue pass.
        if not failed and not (self.task and self.task.is_stopped()):
            DownloadPostProcess(self.task).run()

        return downloaded, failed

    def _process_queued_video(self, video_data) -> bool:
        """Download, index, and archive one leased queue item."""
        youtube_id = video_data["youtube_id"]
        channel_id = video_data["channel_id"]
        print(f"{youtube_id}: Downloading video")
        self._notify(video_data, "Validate download format")
        if not self._dl_single_vid(youtube_id, channel_id):
            return False

        self._notify(video_data, "Add video metadata to index", progress=1)
        video_type = VideoTypeEnum(video_data["vid_type"])
        vid_dict = index_new_video(youtube_id, video_type=video_type)
        RuntimeQueue(self.CHANNEL_QUEUE).add(channel_id)
        RuntimeQueue(self.VIDEO_QUEUE).add(youtube_id)
        self._notify(video_data, "Move downloaded file to archive")
        self.move_to_archive(vid_dict)
        if self.config["downloads"].get("add_metadata") == "simple":
            video = YoutubeVideo(youtube_id)
            video.json_data = vid_dict
            video.embed_metadata(from_download=True)
        self._delete_from_pending(youtube_id)
        return True

    def _auto_ignore(self, video_data) -> bool:
        """check current channel settings before downloading a queued video"""
        channel = YoutubeChannel(video_data["channel_id"])
        channel.get_from_db()
        if not channel.json_data:
            return False

        pattern = channel.get_overwrites().get("auto_ignore_filter")
        title = video_data.get("title")
        if not pattern or not title:
            return False

        try:
            if re.search(pattern, title) is None:
                return False
        except re.error as err:
            print(f"{channel.youtube_id}: invalid auto-ignore filter: {err}")
            return False

        youtube_id = video_data["youtube_id"]
        Download.objects.filter(pk=youtube_id).update(status="ignore")
        self._notify(video_data, "Auto-ignored by channel title filter")
        print(f"{youtube_id}: auto-ignored by channel title filter")
        return True

    def _notify(self, video_data, message, progress=False):
        """send progress notification to task"""
        if not self.task:
            return

        typ = VideoTypeEnum(video_data["vid_type"]).value.rstrip("s").title()
        title = video_data.get("title")
        self.task.send_progress(
            [f"Processing {typ}: {title}", message],
            progress=progress,
            youtube_id=video_data.get("youtube_id"),
        )

    def _clear_retry_errors(self):
        """Clear only errors recorded by earlier attempts of this task."""
        retries = getattr(getattr(self.task, "request", None), "retries", 0)
        task_id = getattr(getattr(self.task, "request", None), "id", None)
        if not retries or not task_id:
            return
        errors = Download.objects.filter(
            status="pending", metadata__retry_task_id=task_id
        )
        for item in errors:
            item.metadata.pop("message", None)
            item.metadata.pop("retry_task_id", None)
            item.save(update_fields=["metadata"])

    def _get_next(self, auto_only):
        """Lease next pending item."""
        eligible = Download.objects.filter(status="pending").exclude(
            metadata__has_key="message"
        )
        if auto_only:
            eligible = eligible.filter(metadata__auto_start=True)
        item_id, _ = self.pending_queue.get_next(
            eligible=eligible.values("pk")
        )
        if not item_id:
            return False
        item = eligible.filter(pk=item_id).first()
        if not item:
            self.pending_queue.release(item_id)
            return False
        self.active_lease = item_id
        return download_data(item)

    def _progress_hook(self, response):
        """Process progress and honor task cancellation."""
        if self.task and self.task.is_stopped():
            raise InterruptedError("Download task stopped")
        if getattr(
            self, "active_lease", None
        ) and not self.pending_queue.renew(self.active_lease):
            raise InterruptedError("Download queue lease expired")
        progress = False
        try:
            size = response.get("_total_bytes_str")
            if size.strip() == "N/A":
                size = response.get("_total_bytes_estimate_str", "N/A")

            percent = response["_percent_str"]
            progress = float(percent.strip("%")) / 100
            speed = response["_speed_str"]
            eta = response["_eta_str"]
            message = f"{percent} of {size} at {speed} - time left: {eta}"
        except KeyError:
            message = "processing"

        if self.task:
            info = response["info_dict"]
            self.task.send_progress(
                [info["title"], message],
                progress=progress,
                youtube_id=info.get("id"),
            )

    def _build_obs(self):
        """collection to build all obs passed to yt-dlp"""
        self._build_obs_basic()
        self._build_obs_user()
        self._build_obs_postprocessors()

    def _build_obs_basic(self):
        """initial obs"""
        self.obs = {
            "merge_output_format": "mp4",
            "outtmpl": (self.CACHE_DIR + "/download/%(id)s.mp4"),
            "progress_hooks": [self._progress_hook],
            "noprogress": True,
            "continuedl": True,
            "writethumbnail": False,
            "noplaylist": True,
            "color": "no_color",
        }

    def _build_obs_user(self):
        """build user customized options"""
        if self.config["downloads"]["format"]:
            self.obs["format"] = self.config["downloads"]["format"]
        if self.config["downloads"]["format_sort"]:
            format_sort = self.config["downloads"]["format_sort"]
            format_sort_list = [i.strip() for i in format_sort.split(",")]
            self.obs["format_sort"] = format_sort_list
        if self.config["downloads"]["limit_speed"]:
            self.obs["ratelimit"] = (
                self.config["downloads"]["limit_speed"] * 1024
            )

        throttle = self.config["downloads"]["throttledratelimit"]
        if throttle:
            self.obs["throttledratelimit"] = throttle * 1024

    def _build_obs_postprocessors(self):
        """add postprocessor to obs"""
        postprocessors = []

        if self.config["downloads"]["add_metadata"] is True:
            # full metadata is added in DownloadPostProcess
            postprocessors.append(
                {
                    "key": "FFmpegMetadata",
                    "add_chapters": True,
                }
            )

        self.obs["postprocessors"] = postprocessors

    def _set_overwrites(self, obs: dict, channel_id: str) -> None:
        """add overwrites to obs"""
        overwrites = self.channel_overwrites.get(channel_id)
        if overwrites and overwrites.get("download_format"):
            obs["format"] = overwrites.get("download_format")

    def _dl_single_vid(self, youtube_id: str, channel_id: str) -> bool:
        """download single video"""
        obs = self.obs.copy()
        self._set_overwrites(obs, channel_id)
        dl_cache = os.path.join(self.CACHE_DIR, "download")

        success, message = YtWrap(obs, self.config).download(youtube_id)
        if not success:
            self._handle_error(
                youtube_id,
                message,
                getattr(getattr(self.task, "request", None), "id", None),
            )

        if self.obs["writethumbnail"]:
            # webp files don't get cleaned up automatically
            all_cached = ignore_filelist(os.listdir(dl_cache))
            to_clean = [i for i in all_cached if not i.endswith(".mp4")]
            for file_name in to_clean:
                file_path = os.path.join(dl_cache, file_name)
                os.remove(file_path)

        return success

    @staticmethod
    def _handle_error(youtube_id, message, task_id=None):
        """Store error message and task identity for safe retries."""
        item = Download.objects.filter(pk=youtube_id).first()
        if item:
            item.metadata["message"] = message
            if task_id:
                item.metadata["retry_task_id"] = task_id
            item.save(update_fields=["metadata"])

    def move_to_archive(self, vid_dict):
        """move downloaded video from cache to archive"""
        # make folder
        folder = os.path.join(
            self.MEDIA_DIR, vid_dict["channel"]["channel_id"]
        )
        if not os.path.exists(folder):
            os.makedirs(folder)

        # move media file
        media_file = vid_dict["youtube_id"] + ".mp4"
        old_path = os.path.join(self.CACHE_DIR, "download", media_file)
        new_path = os.path.join(self.MEDIA_DIR, vid_dict["media_url"])
        shutil.move(old_path, new_path, copy_function=shutil.copyfile)

    @staticmethod
    def _delete_from_pending(youtube_id):
        """delete downloaded video from pending index if its there"""
        Download.objects.filter(pk=youtube_id).delete()

    def _reset_auto(self):
        """reset autostart to defaults after queue stop"""
        updated = 0
        for item in Download.objects.filter(metadata__auto_start=True):
            item.metadata["auto_start"] = False
            item.save(update_fields=["metadata"])
            updated += 1
        if updated:
            print(f"[download] reset auto start on {updated} videos.")


class DownloadPostProcess(DownloaderBase):
    """handle task to run after download queue finishes"""

    def run(self):
        """run all functions"""
        self.auto_delete_all()
        self.auto_delete_overwrites()
        self.refresh_playlist()
        self.match_videos()
        self.get_comments()
        self.embed_metadata()

        RuntimeQueue(self.VIDEO_QUEUE).clear()

    def auto_delete_all(self):
        """handle auto delete"""
        autodelete_days = self.config["downloads"]["autodelete_days"]
        if not autodelete_days:
            return

        print(f"auto delete older than {autodelete_days} days")
        self._auto_delete_watched(
            cutoff=self.now - autodelete_days * 86400, global_only=True
        )

    def auto_delete_overwrites(self):
        """handle per channel auto delete from overwrites"""
        for channel_id, value in self.channel_overwrites.items():
            if "autodelete_days" in value:
                autodelete_days = value.get("autodelete_days")
                if autodelete_days is None:
                    continue

                print(f"{channel_id}: delete older than {autodelete_days}d")
                self._auto_delete_watched(
                    channel_id=channel_id,
                    cutoff=self.now - autodelete_days * 86400,
                )

    def _auto_delete_watched(
        self, cutoff, channel_id=None, global_only=False
    ) -> None:
        """Delete watched videos older than cutoff."""
        query = Video.objects.filter(watched=True, watched_at__lte=cutoff)
        if channel_id:
            query = query.filter(channel_id=channel_id)
        if global_only:
            query = query.filter(
                channel__overrides__autodelete_days__isnull=True
            )
        to_delete = [
            video_data(video) for video in query.select_related("channel")
        ]
        from download.src.rolling_window import owns_video

        delete_and_ignore(
            [
                video
                for video in to_delete
                if not owns_video(video, self.config)
            ]
        )

    def refresh_playlist(self) -> None:
        """match videos with playlists"""
        self.add_playlists_to_refresh()

        queue = RuntimeQueue(self.PLAYLIST_QUEUE)
        while queue.length():
            total = queue.length()
            playlist_id, idx = queue.get_next()
            if not playlist_id:
                break

            try:
                with queue.keepalive(playlist_id):
                    playlist = YoutubePlaylist(playlist_id)
                    playlist.update_playlist(skip_on_empty=True)
                    if not playlist.json_data:
                        raise ValueError("no json data extracted for playlist")
            except ValueError as err:
                message = [
                    f"{playlist_id}: skip failed playlist import",
                    str(err),
                ]
                print(message)
                if self.task:
                    self.task.send_progress(message)
                continue

            queue.ack(playlist_id)
            if not self.task:
                continue

            channel_name = playlist.json_data["playlist_channel"]
            playlist_title = playlist.json_data["playlist_name"]
            message = [
                f"Post Processing Playlists for: {channel_name}",
                f"{playlist_title} [{idx}/{total}]",
            ]
            progress = idx / total
            self.task.send_progress(message, progress=progress)
            rand_sleep(self.config)

    def add_playlists_to_refresh(self) -> None:
        """add playlists to refresh"""
        if self.task:
            message = ["Post Processing Playlists", "Scanning for Playlists"]
            self.task.send_progress(message)

        self._add_playlist_sub()
        self._add_channel_playlists()
        self._add_video_playlists()

    def _add_playlist_sub(self):
        """add subscribed playlists to refresh"""
        playlists = get_playlists(subscribed_only=True, source=["playlist_id"])
        to_add = [i["playlist_id"] for i in playlists]
        RuntimeQueue(self.PLAYLIST_QUEUE).add_list(to_add)

    def _add_channel_playlists(self):
        """add playlists from channels to refresh"""
        queue = RuntimeQueue(self.CHANNEL_QUEUE)
        while True:
            channel_id, _ = queue.get_next()
            if not channel_id:
                break

            with queue.keepalive(channel_id):
                channel = YoutubeChannel(channel_id)
                channel.get_from_db()
                if channel.json_data:
                    overwrites = channel.get_overwrites()
                    if overwrites.get("index_playlists"):
                        channel.get_all_playlists()
                        to_add = [i[0] for i in channel.all_playlists]
                        RuntimeQueue(self.PLAYLIST_QUEUE).add_list(to_add)
            queue.ack(channel_id)

    def _add_video_playlists(self):
        """add other playlists for quick sync"""
        queued = RuntimeQueue(self.PLAYLIST_QUEUE).get_all()
        video_ids = RuntimeQueue(self.VIDEO_QUEUE).get_all()
        to_add = list(
            PlaylistEntry.objects.filter(video_id__in=video_ids)
            .exclude(playlist_id__in=queued)
            .values_list("playlist_id", flat=True)
            .distinct()
        )
        RuntimeQueue(self.PLAYLIST_QUICK).add_list(to_add)

    def match_videos(self) -> None:
        """scan rest of indexed playlists to match videos"""
        queue = RuntimeQueue(self.PLAYLIST_QUICK)
        while queue.length():
            total = queue.length()
            playlist_id, idx = queue.get_next()
            if not playlist_id:
                break

            with queue.keepalive(playlist_id):
                playlist = YoutubePlaylist(playlist_id)
                playlist.get_from_db()
                if not playlist.json_data:
                    print(f"{playlist_id}: skip failed playlist import")
                    queue.release(playlist_id)
                    continue

                playlist.add_vids_to_playlist()
                playlist.remove_vids_from_playlist()
                playlist.match_local()
            queue.ack(playlist_id)

            if not self.task:
                continue

            message = [
                "Post Processing Playlists.",
                f"Validate Playlists: - {idx}/{total}",
            ]
            progress = idx / total
            self.task.send_progress(message, progress=progress)

    def get_comments(self):
        """get comments from youtube"""
        video_queue = RuntimeQueue(self.VIDEO_QUEUE)
        comment_list = CommentList(task=self.task)
        comment_list.add(video_ids=video_queue.get_all())
        comment_list.index()

    def embed_metadata(self):
        """embed metadata in media file"""
        if self.config["downloads"].get("add_metadata") is not True:
            return

        queue = RuntimeQueue(self.VIDEO_QUEUE)
        video_ids = queue.get_all()
        total = len(video_ids)

        for idx, youtube_id in enumerate(video_ids, start=1):
            YoutubeVideo(youtube_id).embed_metadata()
            queue.ack(youtube_id)

            if not self.task:
                continue

            message = [
                "Post Processing Videos.",
                f"Embed metadata: - {idx}/{total}",
            ]
            progress = idx / total
            self.task.send_progress(message, progress=progress)
