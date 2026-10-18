import os
from pathlib import Path

import django
import pytest
from django.test import Client, override_settings
from django.urls import resolve

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()


@pytest.fixture
def frontend_root(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("legacy entry")
    (tmp_path / "new").mkdir()
    (tmp_path / "new" / "index.html").write_text("new entry")
    (tmp_path / "new" / "videos").mkdir()
    (tmp_path / "new" / "videos" / "watch").mkdir()
    (tmp_path / "new" / "videos" / "watch" / "abc").write_text(
        "not an app route"
    )
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "new.js").write_text("new asset")
    from common import views_frontend

    monkeypatch.setattr(views_frontend, "FRONTEND_ROOT", Path(tmp_path))
    return tmp_path


@pytest.fixture
def client():
    with override_settings(
        ROOT_URLCONF="config.urls",
        MIDDLEWARE=[],
        TA_START="test",
    ):
        yield Client()


def test_new_entry_assets_and_legacy_route(frontend_root, client):
    response = client.get("/new/")
    assert response.status_code == 200
    assert response.content == b"new entry"
    assert response["Cache-Control"] == "no-store, no-cache, must-revalidate"
    assert response["Pragma"] == "no-cache"
    assert response["Expires"] == "0"

    asset = client.get("/assets/new.js")
    assert asset.status_code == 200
    assert asset.content == b"new asset"
    assert asset["Cache-Control"] == "public, max-age=31536000, immutable"

    assert client.get("/").content == b"legacy entry"
    assert client.head("/new/").status_code == 200
    assert client.post("/new/").status_code == 405


def test_new_nested_routes_stay_in_new_frontend(frontend_root, client):
    response = client.get("/new/videos/watch/abc")
    assert response.status_code == 200
    assert response.content == b"new entry"
    assert response.content != b"not an app route"
    assert response["Cache-Control"] == "no-store, no-cache, must-revalidate"

    response = client.get("/new/unknown/route")
    assert response.status_code == 200
    assert response.content == b"new entry"
    assert client.head("/new/video/abc?t=12").status_code == 200
    assert client.get("/new/api/not-a-route").content == b"new entry"

    (frontend_root / "new" / "index.html").unlink()
    assert client.get("/new/video/abc").status_code == 404


def test_frontend_boundaries_remain_unchanged(frontend_root, client):
    assert client.get("/new/../index.html").status_code == 404
    assert client.get("/api/not-a-route").status_code == 404
    assert resolve("/admin/login/").app_name == "admin"
    assert client.get("/media/not-a-file").status_code == 404
    assert client.get("/static/not-a-file").status_code == 404
    assert client.post("/new/videos/watch/abc").status_code == 405
