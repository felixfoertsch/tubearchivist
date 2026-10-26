"""Registered TubeArchivist background task functions."""

from appsettings.src.backup import PostgreSQLBackup
from appsettings.src.config import ReleaseVersion
from appsettings.src.filesystem import Scanner
from appsettings.src.manual import ImportFolderScanner
from appsettings.src.reindex import Reindex, ReindexManual, ReindexPopulate
from channel.src.index import YoutubeChannel
from common.src.urlparser import ParsedURLType, Parser
from download.src.queue import PendingList
from download.src.subscriptions import SubscriptionHandler, SubscriptionScanner
from download.src.thumbnails import ThumbValidator
from download.src.yt_dlp_handler import VideoDownloader
from task.src.task_manager import TaskManager
from video.src.meta_embed import MetadataEmbed


def update_subscribed(self):
    manager = TaskManager()
    manager.init(self)
    handler = SubscriptionScanner(task=self)
    added = handler.scan()
    if added and handler.auto_start:
        from task.jobs import enqueue_task

        enqueue_task("download_pending", auto_only=True)
    return f"Found {added} videos to add to the queue." if added else None


def download_pending(self, auto_only=False):
    manager = TaskManager()
    manager.init(self)
    downloaded, failed = VideoDownloader(task=self).run_queue(
        auto_only=auto_only
    )
    if failed and not self.is_stopped():
        from procrastinate import RetryDecision, exceptions

        self.send_progress(["Videos failed; retrying job."])
        raise exceptions.JobRetry(RetryDecision(retry_in={"seconds": 60}))
    return f"downloaded {downloaded} video(s)." if downloaded else None


def extrac_dl(
    self,
    youtube_ids: str | list[ParsedURLType],
    auto_start=False,
    flat=False,
    force=False,
    status="pending",
):
    manager = TaskManager()
    manager.init(self)
    to_add = (
        Parser(youtube_ids).parse()
        if isinstance(youtube_ids, str)
        else youtube_ids
    )
    added = PendingList(
        youtube_ids=to_add,
        task=self,
        auto_start=auto_start,
        flat=flat,
        force=force,
    ).parse_url_list(status=status)
    if auto_start:
        from task.jobs import enqueue_task

        enqueue_task("download_pending", auto_only=True)
    return f"added {added} Videos to Queue" if added else None


def check_reindex(self, data=False, extract_videos=False):
    if data:
        self.send_progress(["Add items to the reindex Queue."])
        ReindexManual(extract_videos=extract_videos).extract_data(data)
    manager = TaskManager()
    manager.init(self)
    if not data:
        populate = ReindexPopulate()
        populate.get_interval()
        populate.add_recent()
        populate.add_outdated()
    handler = Reindex(task=self)
    handler.reindex_all()
    return handler.build_message()


def manual_import(self, ignore_error, prefer_local):
    manager = TaskManager()
    manager.init(self)
    return ImportFolderScanner(
        task=self, ignore_error=ignore_error, prefer_local=prefer_local
    ).scan()


def run_backup(self, reason="auto"):
    manager = TaskManager()
    manager.init(self)
    return PostgreSQLBackup(reason=reason, task=self).create_backup()


def run_restore_backup(self, filename):
    manager = TaskManager()
    manager.init(self)
    self.send_progress(["Restoring backup"])
    PostgreSQLBackup(task=self).restore(filename)
    return f"backup restore completed: {filename}"


def rescan_filesystem(self, ignore_error, prefer_local):
    manager = TaskManager()
    manager.init(self)
    handler = Scanner(
        task=self, ignore_error=ignore_error, prefer_local=prefer_local
    )
    handler.scan()
    handler.apply()
    from task.jobs import enqueue_task

    enqueue_task("thumbnail_check")


def thumbnail_check(self):
    manager = TaskManager()
    manager.init(self)
    thumbnail = ThumbValidator(task=self)
    thumbnail.validate()
    thumbnail.clean_up()


def re_sync_metadata(self):
    manager = TaskManager()
    manager.init(self)
    return MetadataEmbed(task=self).embed()


def subscribe_to(self, url_str: str, expected_type: str | bool = False):
    manager = TaskManager()
    manager.init(self)
    return SubscriptionHandler(url_str, task=self).subscribe(expected_type)


def index_channel_playlists(self, channel_id):
    manager = TaskManager()
    manager.init(self)
    return YoutubeChannel(channel_id, task=self).index_channel_playlists()


def version_check(self):
    return ReleaseVersion().check()


TASKS = {
    "update_subscribed": update_subscribed,
    "download_pending": download_pending,
    "extract_download": extrac_dl,
    "check_reindex": check_reindex,
    "manual_import": manual_import,
    "run_backup": run_backup,
    "restore_backup": run_restore_backup,
    "rescan_filesystem": rescan_filesystem,
    "thumbnail_check": thumbnail_check,
    "resync_metadata": re_sync_metadata,
    "index_playlists": index_channel_playlists,
    "subscribe_to": subscribe_to,
    "version_check": version_check,
}
