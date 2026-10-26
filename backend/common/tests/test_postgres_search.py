"""PostgreSQL search contracts: selectors, ranking, safe subtitle output."""

import pytest
from channel.models import Channel
from common.src.searching import SearchForm, SearchParser
from playlist.models import Playlist
from video.models import SubtitleFragment, Video

pytestmark = pytest.mark.django_db


def setup_search_rows():
    channel = Channel.objects.create(
        id="search-channel", name="Search Channel"
    )
    exact = Video.objects.create(
        id="search-exact", channel=channel, title="Mango Orchard"
    )
    Video.objects.create(
        id="search-prefix", channel=channel, title="Mango Orchards"
    )
    Video.objects.create(
        id="search-typo", channel=channel, title="Mango Orhcard"
    )
    Playlist.objects.create(id="search-playlist", name="Mango Orchard Mix")
    SubtitleFragment.objects.create(
        video=exact,
        language="en",
        source="auto",
        position=0,
        start=1,
        end=2,
        text='<img src=x onerror="alert(1)"> Mango',
    )


def test_parser_preserves_selector_tail_and_filters():
    assert SearchParser("video:cats active:yes").run() == (
        "video",
        "cats",
        {"active": True},
    )
    assert SearchParser("full:hello lang:en source:auto").run() == (
        "full",
        "hello",
        {"lang": "en", "source": "auto"},
    )


def test_search_exact_prefix_and_typo_results_are_bounded_and_ranked():
    setup_search_rows()
    items = SearchForm().multi_search("video:mango orchard")["results"][
        "video_results"
    ]
    assert [item["youtube_id"] for item in items[:2]] == [
        "search-exact",
        "search-prefix",
    ]
    assert "search-typo" in [item["youtube_id"] for item in items]
    assert len(items) <= 30


def test_fulltext_api_preserves_render_contract():
    from rest_framework.test import APIClient
    from user.models import Account

    setup_search_rows()
    client = APIClient()
    client.force_authenticate(Account.objects.create_user("searcher", "pw"))
    response = client.get("/api/search/", {"query": "full:mango lang:en"})
    assert response.status_code == 200
    item = response.data["results"]["fulltext_results"][0]
    assert item["subtitle_fragment_id"] == "search-exact-en-0"
    assert item["title"] == "Mango Orchard"
    assert item["subtitle_channel"] == "Search Channel"
    assert item["subtitle_channel_id"] == "search-channel"
    assert item["subtitle_start"] == "00:00:01.000"
    assert item["subtitle_end"] == "00:00:02.000"
    assert item["subtitle_start"].split(".")[0] == "00:00:01"
    assert item["vid_thumb_url"].endswith("search-exact.jpg")


def test_subtitle_highlight_escapes_untrusted_markup():
    setup_search_rows()
    result = SearchForm().multi_search("full:mango lang:en")["results"][
        "fulltext_results"
    ][0]["subtitle_line"]
    assert "&lt;img" in result
    assert "<img" not in result
    assert '<span class="settings-current">Mango</span>' in result
