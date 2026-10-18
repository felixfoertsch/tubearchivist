"""User view preferences exercise real request validation and serialization."""

import os
from types import SimpleNamespace

import django
import pytest

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

# Django settings must initialize before importing DRF views.
from rest_framework.test import (  # noqa: E402
    APIRequestFactory,
    force_authenticate,
)
from user.src.user_config import UserConfig  # noqa: E402
from user.views import UserConfigView  # noqa: E402


@pytest.fixture
def config_store(monkeypatch):
    config = dict(UserConfig._DEFAULT_USER_SETTINGS)

    class Store:
        def __init__(self, user_id):
            assert user_id == 1

        def get_config(self):
            return dict(config)

        def update_config(self, to_update):
            config.update(to_update)

    monkeypatch.setattr("user.views.UserConfig", Store)
    return config


def request_config(data, authenticated=True):
    request = APIRequestFactory().post("/api/user/me/", data, format="json")
    if authenticated:
        force_authenticate(
            request, SimpleNamespace(id=1, is_authenticated=True)
        )
    return UserConfigView.as_view()(request)


@pytest.mark.parametrize(
    "field", ["view_style_channel", "view_style_playlist"]
)
@pytest.mark.parametrize("style", ["grid", "list", "table"])
def test_partial_view_style_round_trip(config_store, field, style):
    before = dict(config_store)
    response = request_config({field: style})
    assert response.status_code == 200
    assert response.data[field] == style
    assert config_store == {**before, field: style}
    assert response.data["view_style_home"] == before["view_style_home"]


@pytest.mark.parametrize(
    "field", ["view_style_channel", "view_style_playlist"]
)
def test_unsupported_style_rejected_without_write(config_store, field):
    before = dict(config_store)
    response = request_config({field: "unsupported"})
    assert response.status_code == 400
    assert field in response.data
    assert config_store == before


def test_anonymous_config_write_rejected(config_store):
    before = dict(config_store)
    response = request_config(
        {"view_style_channel": "table"}, authenticated=False
    )
    assert response.status_code in (401, 403)
    assert config_store == before
