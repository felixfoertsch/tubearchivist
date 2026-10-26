"""Schema setup uses native migrations, never document-index rewrites."""

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

pytestmark = pytest.mark.django_db


def test_native_schema_has_no_pending_migrations():
    assert connection.vendor == "postgresql"
    executor = MigrationExecutor(connection)
    assert executor.migration_plan(executor.loader.graph.leaf_nodes()) == []
    tables = set(connection.introspection.table_names())
    assert {
        "channel_channel",
        "video_video",
        "playlist_playlistentry",
        "download_download",
        "appsettings_applicationsettings",
    } <= tables


def test_search_indexes_use_postgresql_gin():
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT indexname, indexdef FROM pg_indexes "
            "WHERE schemaname = current_schema() AND indexname = ANY(%s)",
            [
                [
                    "video_text_fts",
                    "video_title_trgm",
                    "subtitle_text_fts",
                    "channel_text_fts",
                    "playlist_text_fts",
                ]
            ],
        )
        indexes = dict(cursor.fetchall())
    assert len(indexes) == 5
    assert all("USING gin" in definition for definition in indexes.values())
