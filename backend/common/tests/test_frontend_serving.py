import os
from pathlib import Path

import django
import pytest
from django.test import Client, override_settings

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()


@pytest.fixture
def frontend_root(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("legacy entry")
    (tmp_path / "new").mkdir()
    (tmp_path / "new" / "index.html").write_text(
        '<script type="module" src="/assets/new.js"></script>'
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
    assert b"/assets/new.js" in response.content
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


def test_new_entry_rejects_nested_route_and_traversal(frontend_root, client):
    assert client.get("/new/missing").status_code == 404
    assert client.get("/new/../index.html").status_code == 404
