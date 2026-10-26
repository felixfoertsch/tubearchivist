"""PostgreSQL-backed multi-index search."""

import html
import re

from channel.models import Channel
from common.src.domain import channel_data, playlist_data, video_data
from common.src.search_processor import SearchProcess
from django.contrib.postgres.lookups import TrigramSimilar
from django.contrib.postgres.search import (
    SearchQuery,
    SearchRank,
    SearchVector,
    TrigramSimilarity,
)
from django.db.models import Case, F, FloatField, Q, Value, When
from playlist.models import Playlist
from video.models import SubtitleFragment, Video


def _search_videos(kind, terms, filters, fuzzy):
    queryset = Video.objects.select_related("channel")
    if kind == "video":
        if "active" in filters:
            queryset = queryset.filter(active=filters["active"])
        if filters.get("channel"):
            queryset = queryset.filter(
                channel__name__icontains=filters["channel"]
            )
    return _search_records(
        queryset,
        terms,
        ("title", "description"),
        fuzzy,
        "ta_video",
        video_data,
    )


def _search_channels(kind, terms, filters, fuzzy):
    queryset = Channel.objects.all()
    if kind == "channel":
        queryset = _apply_subscription_filters(queryset, filters)
    return _search_records(
        queryset,
        terms,
        ("name", "description"),
        fuzzy,
        "ta_channel",
        channel_data,
    )


def _search_playlists(kind, terms, filters, fuzzy):
    queryset = Playlist.objects.all()
    if kind == "playlist":
        queryset = _apply_subscription_filters(queryset, filters)
    return _search_records(
        queryset,
        terms,
        ("name", "description"),
        fuzzy,
        "ta_playlist",
        playlist_data,
    )


def _apply_subscription_filters(queryset, filters):
    for field in ("active", "subscribed"):
        if field in filters:
            queryset = queryset.filter(**{field: filters[field]})
    return queryset


def _search_records(queryset, terms, fields, fuzzy, index, converter):
    if terms:
        queryset = _search(queryset, terms, fields, fuzzy)
    else:
        queryset = queryset.order_by(fields[0], "pk")[:30]
    return _ranked(queryset, index, converter)


def _search_subtitles(terms, filters):
    queryset = SubtitleFragment.objects.select_related(
        "video", "video__channel"
    )
    for field, model_field in (("lang", "language"), ("source", "source")):
        if filters.get(field):
            queryset = queryset.filter(
                **{f"{model_field}__iexact": filters[field]}
            )
    if filters.get("channel"):
        queryset = queryset.filter(
            video__channel__name__icontains=filters["channel"]
        )
    if terms:
        vector = SearchVector("text", config="english")
        query = SearchQuery(terms, config="english", search_type="websearch")
        queryset = (
            queryset.annotate(_rank=SearchRank(vector, query))
            .filter(Q(_rank__gt=0) | Q(text__icontains=terms))
            .order_by("-_rank", "video_id", "language", "position")
        )
    else:
        queryset = queryset.order_by("video_id", "language", "position")
    return [_subtitle_result(row, terms) for row in queryset[:30]]


def _subtitle_result(row, terms):
    def timestamp(seconds):
        milliseconds = round(seconds * 1000)
        hours, remainder = divmod(milliseconds, 3600000)
        minutes, remainder = divmod(remainder, 60000)
        seconds, milliseconds = divmod(remainder, 1000)
        return f"{hours:02}:{minutes:02}:{seconds:02}.{milliseconds:03}"

    line = html.escape(row.text)
    if terms:
        safe_text, safe_term = line, html.escape(terms)
        line = re.sub(
            re.escape(safe_term),
            lambda match: '<span class="settings-current">'
            + match.group(0)
            + "</span>",
            safe_text,
            flags=re.IGNORECASE,
        )
    return {
        "youtube_id": row.video_id,
        "subtitle_lang": row.language,
        "subtitle_source": row.source,
        "subtitle_line": line,
        "subtitle_start": timestamp(row.start),
        "subtitle_end": timestamp(row.end),
        "subtitle_fragment_id": (
            f"{row.video_id}-{row.language}-{row.position}"
        ),
        "title": row.video.title,
        "subtitle_channel": row.video.channel.name,
        "subtitle_channel_id": row.video.channel_id,
        "_index": "ta_subtitle",
        "_score": float(getattr(row, "_rank", 1) or 1),
    }


class SearchForm:
    def multi_search(self, search_query):
        kind, terms, filters = SearchParser(search_query).run()
        fuzzy = filters.get("fuzzy", "auto") != "no"
        results = []
        if kind in ("simple", "video"):
            results.extend(_search_videos(kind, terms, filters, fuzzy))
        if kind in ("simple", "channel"):
            results.extend(_search_channels(kind, terms, filters, fuzzy))
        if kind in ("simple", "playlist"):
            results.extend(_search_playlists(kind, terms, filters, fuzzy))
        if kind == "full":
            results.extend(_search_subtitles(terms, filters))
        results.sort(
            key=lambda item: (
                -item["_score"],
                _display_name(item).casefold(),
                _identity(item),
            )
        )
        return {
            "results": self.build_results(SearchProcess(results).process()),
            "queryType": kind,
        }

    @staticmethod
    def build_results(items):
        groups = {
            "video_results": [],
            "channel_results": [],
            "playlist_results": [],
            "fulltext_results": [],
        }
        for item in items:
            index = item.get("_index", "")
            key = (
                "video_results"
                if index.startswith("ta_video")
                else (
                    "channel_results"
                    if index.startswith("ta_channel")
                    else (
                        "playlist_results"
                        if index.startswith("ta_playlist")
                        else "fulltext_results"
                    )
                )
            )
            groups[key].append(item)
        return groups


def _display_name(item):
    return (
        item.get("title")
        or item.get("channel_name")
        or item.get("playlist_name")
        or ""
    )


def _identity(item):
    return (
        item.get("youtube_id")
        or item.get("channel_id")
        or item.get("playlist_id")
        or ""
    )


def _search(queryset, term, fields, fuzzy):
    vector = SearchVector(*fields, config="english")
    query = SearchQuery(term, config="english", search_type="websearch")
    ranked = queryset.annotate(_rank=SearchRank(vector, query))
    text_q = Q(_rank__gt=0)
    prefix_q = Q(pk__isnull=True)
    fuzzy_q = Q(pk__isnull=True)
    rank_expr = F("_rank")
    for field in fields:
        prefix_q |= Q(**{f"{field}__istartswith": term})
        if fuzzy:
            fuzzy_q |= TrigramSimilar(F(field), term)
    similarity = TrigramSimilarity(fields[0], term)
    for field in fields[1:]:
        similarity = Case(
            When(
                TrigramSimilar(F(field), term),
                then=TrigramSimilarity(field, term),
            ),
            default=similarity,
            output_field=FloatField(),
        )
    qs = ranked.annotate(_similarity=similarity)
    qs = qs.annotate(
        _search_score=Case(
            When(**{f"{fields[0]}__iexact": term}, then=Value(3.0)),
            When(prefix_q, then=Value(2.0)),
            default=rank_expr + F("_similarity"),
            output_field=FloatField(),
        )
    )
    matched = text_q | prefix_q | (fuzzy_q if fuzzy else Q(pk__isnull=True))
    return qs.filter(matched).order_by("-_search_score", "pk")[:30]


def _ranked(queryset, index, converter):
    return [
        {
            **converter(obj),
            "_index": index,
            "_score": float(
                getattr(obj, "_search_score", getattr(obj, "_rank", 1)) or 0
            ),
        }
        for obj in queryset
    ]


class SearchParser:
    """Parse legacy search selectors and inline filters."""

    TYPES = {
        "simple": set(),
        "video": {"channel", "active", "fuzzy"},
        "channel": {"active", "subscribed", "fuzzy"},
        "playlist": {"active", "subscribed", "fuzzy"},
        "full": {"lang", "source", "channel", "fuzzy"},
    }

    def __init__(self, search_query):
        self.search_query = search_query.strip()

    def run(self):
        words = self.search_query.split()
        kind = "simple"
        if (
            words
            and ":" in words[0]
            and words[0].split(":", 1)[0] in self.TYPES
        ):
            first, value = words.pop(0).split(":", 1)
            kind = first
            if value:
                words.insert(0, value)
        terms, filters = [], {}
        for word in words:
            if ":" in word:
                key, value = word.split(":", 1)
                if key in self.TYPES[kind]:
                    filters[key] = value
                    continue
            terms.append(word)
        if "active" in filters:
            filters["active"] = filters["active"].casefold() == "yes"
        if "subscribed" in filters:
            filters["subscribed"] = filters["subscribed"].casefold() == "yes"
        return kind, " ".join(terms), filters
