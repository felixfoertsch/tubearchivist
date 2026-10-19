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
    (tmp_path / "index.html").write_text("new entry")
    (tmp_path / "old").mkdir()
    (tmp_path / "old" / "index.html").write_text("classic entry")
    (tmp_path / "old" / "videos").mkdir()
    (tmp_path / "old" / "videos" / "watch").mkdir()
    (tmp_path / "old" / "videos" / "watch" / "abc").write_text(
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


def test_new_entry_at_root_and_classic_at_old(frontend_root, client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.content == b"new entry"
    assert response["Cache-Control"] == "no-store, no-cache, must-revalidate"
    assert response["Pragma"] == "no-cache"
    assert response["Expires"] == "0"
    assert client.get("/video/abc").content == b"new entry"

    asset = client.get("/assets/new.js")
    assert asset.status_code == 200
    assert asset.content == b"new asset"
    assert asset["Cache-Control"] == "public, max-age=31536000, immutable"

    classic = client.get("/old/")
    assert classic.content == b"classic entry"
    assert classic["Cache-Control"] == "no-store, no-cache, must-revalidate"
    assert client.head("/old/").status_code == 200
    assert client.post("/old/").status_code == 405


def test_classic_nested_routes_stay_in_classic_frontend(frontend_root, client):
    response = client.get("/old/videos/watch/abc")
    assert response.status_code == 200
    assert response.content == b"classic entry"
    assert response["Cache-Control"] == "no-store, no-cache, must-revalidate"

    assert client.get("/old/unknown/route").content == b"classic entry"
    assert client.head("/old/video/abc?t=12").status_code == 200
    assert client.get("/old/api/not-a-route").content == b"classic entry"

    (frontend_root / "old" / "index.html").unlink()
    assert client.get("/old/video/abc").status_code == 404


def test_legacy_new_paths_redirect_to_root(frontend_root, client):
    for path, target in [
        ("/new/", "/"),
        ("/new/video/abc?t=12", "/video/abc?t=12"),
        ("/new/settings/", "/settings/"),
        ("/new//evil.test/", "/evil.test/"),
        ("/new/%5C%5Cevil.test/", "/evil.test/"),
    ]:
        response = client.get(path)
        assert response.status_code == 302, path
        assert response["Location"] == target, path
    assert client.post("/new/").status_code == 405


def test_frontend_boundaries_remain_unchanged(frontend_root, client):
    assert client.get("/old/../index.html").status_code == 404
    assert client.get("/api/not-a-route").status_code == 404
    assert resolve("/admin/login/").app_name == "admin"
    assert client.get("/media/not-a-file").status_code == 404
    assert client.get("/static/not-a-file").status_code == 404
    assert client.post("/old/videos/watch/abc").status_code == 405
