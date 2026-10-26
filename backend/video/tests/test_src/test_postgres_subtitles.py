"""Subtitle metadata round-trips through native PostgreSQL storage."""

import json

import pytest
from channel.models import Channel
from common.src.domain import save_video
from video.models import SubtitleFragment, Video
from video.src.index import index_new_video
from video.src.meta_embed import IndexFromEmbed
from video.src.subtitle import SubtitleParser, YoutubeSubtitle

pytestmark = pytest.mark.django_db(transaction=True)


def test_subtitle_export_import_preserves_schema_and_other_sources():
    channel = Channel.objects.create(id="subtitle-channel", name="Channel")
    video = save_video(
        {
            "youtube_id": "subtitle-video",
            "channel": {
                "channel_id": channel.pk,
                "channel_name": channel.name,
            },
            "title": "Subtitle test",
            "vid_type": "videos",
            "subtitles": [{"lang": "en", "source": "user"}],
        }
    )
    SubtitleFragment.objects.create(
        video=video,
        language="en",
        source="user",
        position=1,
        start=0.0,
        end=2.0,
        text="Original line",
        metadata={"subtitle_channel": "Channel", "title": "Subtitle test"},
    )
    SubtitleFragment.objects.create(
        video=video,
        language="de",
        source="auto",
        position=1,
        start=0.0,
        end=1.0,
        text="Andere Zeile",
    )
    subs = YoutubeSubtitle(video)
    exported = subs.get_saved_subtitles()
    english = next(item for item in exported if item["subtitle_lang"] == "en")
    assert english["subtitle_fragment_id"] == "subtitle-video-en-1"
    assert english["subtitle_line"] == "Original line"

    replacement = [
        {
            **english,
            "subtitle_index": 1,
            "subtitle_start": "00:00:01.000",
            "subtitle_end": "00:00:03.000",
            "subtitle_line": "Replaced line",
        }
    ]
    subs.replace_subtitles(video, replacement, lang="en", source="user")
    rows = list(
        SubtitleFragment.objects.filter(video=video).order_by("language")
    )
    assert [(row.language, row.source, row.text) for row in rows] == [
        ("de", "auto", "Andere Zeile"),
        ("en", "user", "Replaced line"),
    ]


def test_index_new_video_saves_before_checking_subtitles(
    monkeypatch, tmp_path
):
    from video.src import index

    channel = Channel.objects.create(
        id="subtitle-index-channel", name="Channel"
    )
    from appsettings.src.config import AppConfig
    from common.src.env_settings import EnvironmentSettings

    monkeypatch.setattr(EnvironmentSettings, "MEDIA_DIR", str(tmp_path))
    (tmp_path / channel.pk).mkdir()
    AppConfig().update_config(
        {
            "downloads": {
                "subtitle": "en",
                "subtitle_source": "user",
                "subtitle_index": True,
                "integrate_sponsorblock": False,
                "integrate_ryd": False,
            }
        }
    )
    metadata = {
        "id": "subtitle-index-video",
        "channel_id": channel.pk,
        "title": "Indexed video",
        "thumbnail": "https://example.test/thumb.jpg",
        "upload_date": "20260101",
        "duration": 2,
        "subtitles": {
            "en": [
                {
                    "ext": "json3",
                    "url": "https://example.test/subtitle.json3",
                    "name": "English",
                }
            ]
        },
    }

    def add_channel(self):
        self.json_data["channel"] = {
            "channel_id": channel.pk,
            "channel_name": channel.name,
        }

    monkeypatch.setattr(
        index.YoutubeVideo,
        "get_from_youtube",
        lambda self: setattr(self, "youtube_meta", metadata),
    )
    monkeypatch.setattr(index.YoutubeVideo, "_add_channel", add_channel)
    monkeypatch.setattr(
        index.YoutubeVideo,
        "add_player",
        lambda self, media_path=False: self.json_data.update(
            {"player": {"duration": 2}}
        ),
    )
    monkeypatch.setattr(
        index.YoutubeVideo,
        "add_streams",
        lambda self, media_path=False: self.json_data.update(
            {"streams": [], "media_size": 1}
        ),
    )
    requests = []

    def subtitle_request(self, url, lang):
        requests.append(url)
        if len(requests) == 1:
            raise ConnectionError("interrupted subtitle download")
        return (
            '{"events":[{"tStartMs":1250,"dDurationMs":750,'
            '"segs":[{"utf8":"Indexed subtitle"}]}]}'
        )

    monkeypatch.setattr(
        index.YoutubeSubtitle, "_make_request", subtitle_request
    )
    monkeypatch.setattr("video.src.subtitle.rand_sleep", lambda config: None)
    monkeypatch.setattr(
        index.ThumbManager, "download_video_thumb", lambda self, url: None
    )

    with pytest.raises(ConnectionError, match="interrupted subtitle"):
        index_new_video("subtitle-index-video")
    assert Video.objects.filter(pk="subtitle-index-video").count() == 1
    assert not SubtitleFragment.objects.filter(
        video_id="subtitle-index-video"
    ).exists()
    result = index_new_video("subtitle-index-video")
    index_new_video("subtitle-index-video")
    assert Video.objects.filter(pk="subtitle-index-video").count() == 1
    assert (
        SubtitleFragment.objects.filter(
            video_id="subtitle-index-video"
        ).count()
        == 1
    )

    assert result["youtube_id"] == "subtitle-index-video"
    assert result["subtitles"][0]["lang"] == "en"
    assert Video.objects.filter(pk="subtitle-index-video").exists()
    fragment = SubtitleFragment.objects.get(video_id="subtitle-index-video")
    assert (fragment.start, fragment.end, fragment.text) == (
        1.25,
        2.0,
        "Indexed subtitle",
    )


def test_embedded_subtitle_import_replaces_fragments_and_replay_is_idempotent(
    tmp_path,
):
    channel = Channel.objects.create(
        id="subtitle-embed-channel", name="Channel"
    )
    video = save_video(
        {
            "youtube_id": "subtitle-embed-video",
            "channel": {
                "channel_id": channel.pk,
                "channel_name": channel.name,
            },
            "title": "Embedded test",
            "vid_type": "videos",
            "media_url": f"{channel.pk}/subtitle-embed-video.mp4",
        }
    )
    imported = [
        {
            "subtitle_channel": channel.name,
            "subtitle_channel_id": channel.pk,
            "subtitle_end": "00:00:02.000",
            "subtitle_fragment_id": f"{video.pk}-en-1",
            "subtitle_index": 1,
            "subtitle_lang": "en",
            "subtitle_last_refresh": 1,
            "subtitle_line": "Imported line",
            "subtitle_source": "user",
            "subtitle_start": "00:00:01.000",
            "title": video.title,
            "youtube_id": video.pk,
        }
    ]
    importer = IndexFromEmbed(
        str(tmp_path / "source.mp4"), use_user_conf=False
    )
    importer.VIDEOS_BASE = str(tmp_path)
    embed = {"video": {}, "subtitles": imported}

    from video.src.index import YoutubeVideo

    wrapper = YoutubeVideo(video.pk)
    wrapper.get_from_db()
    importer.index_subtitles(embed, wrapper)
    importer.index_subtitles(embed, wrapper)

    rows = list(SubtitleFragment.objects.filter(video=video))
    assert [(row.position, row.start, row.end, row.text) for row in rows] == [
        (1, 1.0, 2.0, "Imported line")
    ]
    assert (tmp_path / video.media_url.replace(".mp4", ".en.vtt")).exists()
    saved = YoutubeSubtitle(video).get_saved_subtitles()[0]
    assert saved["subtitle_start"] == "00:00:01.000"
    assert saved["subtitle_end"] == "00:00:02.000"


def test_parser_wire_timestamp_strings_replace_database_fragments():
    channel = Channel.objects.create(
        id="subtitle-parser-channel", name="Channel"
    )
    video = save_video(
        {
            "youtube_id": "subtitle-parser-video",
            "channel": {
                "channel_id": channel.pk,
                "channel_name": channel.name,
            },
            "title": "Parser test",
            "vid_type": "videos",
        }
    )
    parser = SubtitleParser(
        '{"events":[{"tStartMs":1250,"dDurationMs":750,'
        '"segs":[{"utf8":"Parsed line"}]}]}',
        "en",
        "user",
    )
    parser.process()
    documents = parser.create_documents(
        type(
            "VideoData",
            (),
            {
                "youtube_id": video.pk,
                "json_data": {
                    "title": video.title,
                    "channel": {
                        "channel_name": channel.name,
                        "channel_id": channel.pk,
                    },
                },
            },
        )(),
        "user",
    )

    assert parser.all_cues[0]["start"] == "00:00:01.250"
    assert parser.all_cues[0]["end"] == "00:00:02.000"
    YoutubeSubtitle.replace_subtitles(
        video, documents, lang="en", source="user"
    )

    fragment = SubtitleFragment.objects.get(video=video)
    assert (fragment.start, fragment.end, fragment.text) == (
        1.25,
        2.0,
        "Parsed line",
    )


@pytest.mark.parametrize(
    ("start_ms", "duration_ms", "expected_start", "expected_end"),
    [
        (1, 2, "00:00:00.001", "00:00:00.003"),
        (999, 2, "00:00:00.999", "00:00:01.001"),
    ],
)
def test_parser_rounds_milliseconds_before_timestamp_decomposition(
    start_ms, duration_ms, expected_start, expected_end
):
    parser = SubtitleParser(
        json.dumps(
            {
                "events": [
                    {
                        "tStartMs": start_ms,
                        "dDurationMs": duration_ms,
                        "segs": [{"utf8": "line"}],
                    }
                ]
            }
        ),
        "en",
        "user",
    )
    parser.process()
    assert parser.all_cues[0]["start"] == expected_start
    assert parser.all_cues[0]["end"] == expected_end


def test_invalid_import_preserves_existing_fragments():
    channel = Channel.objects.create(
        id="subtitle-invalid-channel", name="Channel"
    )
    video = save_video(
        {
            "youtube_id": "subtitle-invalid-video",
            "channel": {"channel_id": channel.pk},
            "title": "Video",
            "vid_type": "videos",
        }
    )
    saved = SubtitleFragment.objects.create(
        video=video,
        language="en",
        source="user",
        position=1,
        start=0,
        end=1,
        text="Keep this",
    )
    with pytest.raises(ValueError, match="identity mismatch"):
        YoutubeSubtitle(video).replace_subtitles(
            video,
            [
                {
                    "youtube_id": video.pk,
                    "subtitle_lang": "de",
                    "subtitle_source": "user",
                    "subtitle_index": 1,
                    "subtitle_start": "0",
                    "subtitle_end": "1",
                    "subtitle_line": "Bad identity",
                }
            ],
            lang="en",
            source="user",
        )
    saved.refresh_from_db()
    assert saved.text == "Keep this"
