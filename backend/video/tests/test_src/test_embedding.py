"""Embedding modes keep archived files stable unless full mode is selected."""

import unittest
from unittest.mock import MagicMock, patch

from appsettings.serializers import AppConfigDownloadsSerializer
from django.conf import settings
from download.src.thumbnails import ThumbManager
from download.src.yt_dlp_handler import DownloadPostProcess, VideoDownloader
from video.src.index import YoutubeVideo


class EmbeddingTests(unittest.TestCase):
    """Exercise mode validation and MP4 writes without network or media IO."""

    @classmethod
    def setUpClass(cls):
        """Allow standalone unittest runs without starting Django services."""
        if not settings.configured:
            settings.configure(USE_I18N=False)

    def make_video(self, mode):
        """Avoid constructor network configuration reads."""
        video = object.__new__(YoutubeVideo)
        video.youtube_id = "test-video"
        video.config = {"downloads": {"add_metadata": mode}}
        video.json_data = {
            "title": "Title",
            "description": "Description",
            "channel": {"channel_name": "Artist", "channel_id": "channel"},
            "media_url": "channel/test-video.mp4",
        }
        return video

    def test_modes_validate_and_preserve_booleans(self):
        """Existing settings remain valid; arbitrary strings are rejected."""
        for mode in (False, True, "simple"):
            serializer = AppConfigDownloadsSerializer(
                data={"add_metadata": mode}, partial=True
            )
            self.assertTrue(serializer.is_valid(), serializer.errors)
            self.assertEqual(serializer.validated_data["add_metadata"], mode)
        serializer = AppConfigDownloadsSerializer(
            data={"add_metadata": "invalid"}, partial=True
        )
        self.assertFalse(serializer.is_valid())

    def test_off_and_simple_refresh_do_not_touch_files(self):
        """All non-download callers use the default read-only simple path."""
        for mode, from_download in (
            (False, False),
            (False, True),
            ("simple", False),
        ):
            video = self.make_video(mode)
            with patch.object(video, "_embed_text_data") as text, patch.object(
                video, "_embed_artwork"
            ) as art, patch.object(video, "get_from_es") as fetch:
                video.embed_metadata(from_download=from_download)
                text.assert_not_called()
                art.assert_not_called()
                fetch.assert_not_called()

    def test_full_retains_refresh_embedding(self):
        """Full mode keeps existing archive and artwork behavior."""
        video = self.make_video(True)
        with patch.object(video, "_embed_text_data") as text, patch.object(
            video, "_embed_artwork"
        ) as art:
            video.embed_metadata()
            text.assert_called_once_with(simple=False)
            art.assert_called_once_with()

    def test_simple_download_has_only_static_text_tags(self):
        """No archive JSON or stats are generated for simple downloads."""
        video = self.make_video("simple")
        tags = MagicMock()
        with patch("video.src.index.MP4", return_value=tags), patch(
            "video.src.index.os.path.exists", return_value=True
        ), patch("video.src.index.ThumbManager") as thumbs, patch.object(
            video, "_get_to_embed"
        ) as archive:
            video.embed_metadata(from_download=True)
            self.assertEqual(
                tags.__setitem__.call_args_list,
                [
                    unittest.mock.call("\xa9nam", ["Title"]),
                    unittest.mock.call("\xa9ART", ["Artist"]),
                    unittest.mock.call("desc", ["Description"]),
                    unittest.mock.call("ldes", ["Description"]),
                ],
            )
            tags.save.assert_called_once_with()
            archive.assert_not_called()
            thumbs.return_value.embed_video_art.assert_called_once_with(
                video.json_data, simple=True
            )

    def test_simple_skips_queue_and_full_chapter_postprocessor(self):
        """Simple must not re-embed queue entries or add dynamic chapters."""
        postprocess = object.__new__(DownloadPostProcess)
        postprocess.config = {"downloads": {"add_metadata": "simple"}}
        with patch("download.src.yt_dlp_handler.RedisQueue") as queue:
            postprocess.embed_metadata()
            queue.assert_not_called()
        downloader = object.__new__(VideoDownloader)
        downloader.config = postprocess.config
        downloader.obs = {}
        downloader._build_obs_postprocessors()
        self.assertEqual(downloader.obs["postprocessors"], [])

    def test_simple_artwork_writes_cover_only(self):
        """Channel and playlist artwork never enter simple MP4s."""
        manager = object.__new__(ThumbManager)
        manager.item_id = "test-video"
        tags = MagicMock()
        with patch("download.src.thumbnails.MP4", return_value=tags), patch(
            "download.src.thumbnails.os.path.exists", return_value=True
        ), patch.object(
            manager, "vid_thumb_path", return_value="thumb.jpg"
        ), patch(
            "builtins.open", unittest.mock.mock_open(read_data=b"thumbnail")
        ), patch.object(
            manager, "_embed_art_item"
        ) as extra:
            manager.embed_video_art(
                self.make_video("simple").json_data, simple=True
            )
            self.assertEqual(tags.__setitem__.call_args.args[0], "covr")
            tags.save.assert_called_once_with()
            extra.assert_not_called()


if __name__ == "__main__":
    unittest.main()
