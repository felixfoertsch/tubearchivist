"""Real Authlib exchange/validation against an isolated simulated provider."""

import base64
import hashlib
import json
import time
from urllib.parse import parse_qs, urlsplit

import pytest
import requests
from django.test import Client
from joserfc import jwt
from joserfc.jwk import RSAKey
from user.models import Account, FederatedIdentity, OIDCTransaction
from user.oidc import resolve_account

pytestmark = pytest.mark.django_db
ISSUER = "https://identity.example/application/o/tube/"
CALLBACK = "/api/user/oidc/callback/"


@pytest.fixture
def provider(settings, monkeypatch):
    settings.TA_OIDC_ISSUER = ISSUER
    settings.TA_OIDC_CLIENT_ID = "tube-client"
    settings.TA_OIDC_CLIENT_SECRET = "test-secret"
    settings.TA_OIDC_REDIRECT_URI = "https://testserver" + CALLBACK
    key = RSAKey.generate_key(2048, parameters={"kid": "test"})
    config = {"changes": {}, "key": key, "nonce": "", "exchanges": 0}

    def request(_session, method, url, **kwargs):
        assert kwargs.get("timeout") == 10
        assert kwargs.get("allow_redirects") is False
        response = requests.Response()
        response.status_code = 200
        if url.endswith("openid-configuration"):
            data = {
                "issuer": config.get("issuer", ISSUER),
                "authorization_endpoint": ISSUER + "authorize/",
                "token_endpoint": ISSUER + "token/",
                "jwks_uri": ISSUER + "jwks/",
                "id_token_signing_alg_values_supported": ["RS256"],
            }
        elif url.endswith("jwks/"):
            data = {
                "keys": [config.get("jwks_key", key).as_dict(private=False)]
            }
        elif url.endswith("token/"):
            config["exchanges"] += 1
            assert kwargs.get("timeout") == 10
            verifier = kwargs["data"]["code_verifier"]
            challenge = (
                base64.urlsafe_b64encode(
                    hashlib.sha256(verifier.encode()).digest()
                )
                .rstrip(b"=")
                .decode()
            )
            assert challenge == config["challenge"]
            claims = {
                "iss": ISSUER,
                "sub": "test-subject",
                "aud": "tube-client",
                "iat": int(time.time()),
                "exp": int(time.time()) + 300,
                "nonce": config["nonce"],
            }
            claims.update(config["changes"])
            for field in config.get("omit", []):
                claims.pop(field, None)
            data = {
                "access_token": "temporary-access",
                "token_type": "Bearer",
                "id_token": jwt.encode(
                    {"alg": "RS256", "kid": "test"},
                    claims,
                    config["key"],
                ),
            }
        else:
            raise AssertionError(url)
        response._content = json.dumps(data).encode()
        return response

    monkeypatch.setattr(requests.Session, "request", request)
    return config


def begin(browser, provider, next_path="/channels/"):
    response = browser.get("/api/user/oidc/login/", {"next": next_path})
    assert response.status_code == 302
    query = parse_qs(urlsplit(response.url).query)
    assert query["code_challenge_method"] == ["S256"]
    assert query["redirect_uri"] == ["https://testserver" + CALLBACK]
    provider["nonce"] = query["nonce"][0]
    provider["challenge"] = query["code_challenge"][0]
    return query["state"][0]


def finish(browser, state):
    return browser.get(CALLBACK, {"state": state, "code": "test-code"})


def test_session_identity_and_replay(provider):
    existing = Account.objects.create_user("test-user", "password")
    browser = Client()
    state = begin(browser, provider)
    old_session = browser.session.session_key
    response = finish(browser, state)
    assert response.url == "/channels/"
    account = Account.objects.get(pk=browser.session["_auth_user_id"])
    assert account != existing
    assert not account.has_usable_password()
    assert not account.is_staff and not account.is_superuser
    assert browser.session.session_key != old_session
    assert FederatedIdentity.objects.get().account == account
    assert finish(browser, state).url == "/login/?oidc_error=1"
    assert provider["exchanges"] == 1
    assert resolve_account(ISSUER, "test-subject") == account
    assert Account.objects.count() == 2


@pytest.mark.parametrize(
    "changes",
    [
        {"iss": "https://evil.example/"},
        {"aud": "other-client"},
        {"aud": "other-client", "azp": "tube-client"},
        {"nonce": "other-nonce"},
        {"exp": 1},
        {"sub": ""},
    ],
)
def test_invalid_claims_fail_closed(provider, changes):
    browser = Client()
    state = begin(browser, provider)
    provider["changes"] = changes
    assert finish(browser, state).url == "/login/?oidc_error=1"
    assert "_auth_user_id" not in browser.session
    assert not FederatedIdentity.objects.exists()
    assert finish(browser, state).url == "/login/?oidc_error=1"
    assert provider["exchanges"] == 1


@pytest.mark.parametrize("field", ["exp", "nonce", "aud", "iat", "sub"])
def test_missing_required_claim(provider, field):
    browser = Client()
    state = begin(browser, provider)
    provider["omit"] = [field]
    assert finish(browser, state).url == "/login/?oidc_error=1"
    assert not Account.objects.exists()


def test_rotated_signing_key(provider):
    browser = Client()
    state = begin(browser, provider)
    rotated = RSAKey.generate_key(2048, parameters={"kid": "test"})
    provider["key"] = rotated
    provider["jwks_key"] = rotated
    assert finish(browser, state).url == "/channels/"


def test_wrong_signature(provider):
    browser = Client()
    state = begin(browser, provider)
    provider["key"] = RSAKey.generate_key(2048, parameters={"kid": "test"})
    assert finish(browser, state).url == "/login/?oidc_error=1"
    assert not Account.objects.exists()


def test_state_cross_browser_and_missing(provider):
    browser = Client()
    state = begin(browser, provider)
    assert finish(Client(), state).url == "/login/?oidc_error=1"
    assert finish(browser, "wrong").url == "/login/?oidc_error=1"
    assert provider["exchanges"] == 0
    assert finish(browser, state).url == "/channels/"


def test_expired_transaction(provider):
    from datetime import timedelta

    from django.utils import timezone

    browser = Client()
    state = begin(browser, provider)
    OIDCTransaction.objects.update(
        created_at=timezone.now() - timedelta(minutes=6)
    )
    assert finish(browser, state).url == "/login/?oidc_error=1"
    assert provider["exchanges"] == 0


@pytest.mark.parametrize(
    "target",
    [
        "//evil.example/",
        "/%2fevil.example/",
        "/%5cevil.example/",
        "https://evil.example/",
        "/\\evil.example/",
        "/\nredirect",
    ],
)
def test_return_path(provider, target):
    browser = Client()
    state = begin(browser, provider, target)
    assert finish(browser, state).url == "/"


@pytest.mark.parametrize(
    "value",
    [
        "http://identity.example/",
        "https://user:secret@identity.example/",
        "https://identity.example/?query=1",
    ],
)
def test_invalid_configuration(provider, settings, value):
    settings.TA_OIDC_ISSUER = value
    response = Client().get("/api/user/oidc/login/")
    assert response.url == "/login/?oidc_error=1"
    assert "secret" not in response.url
    assert not OIDCTransaction.objects.exists()


def test_provider_timeout(provider, monkeypatch):
    def unavailable(*args, **kwargs):
        raise requests.Timeout("private provider details")

    monkeypatch.setattr(requests.Session, "request", unavailable)
    response = Client().get("/api/user/oidc/login/")
    assert response.url == "/login/?oidc_error=1"
    assert not OIDCTransaction.objects.exists()


def test_discovery_mismatch(provider):
    provider["issuer"] = "https://wrong.example/"
    assert Client().get("/api/user/oidc/login/").url == "/login/?oidc_error=1"
    assert not OIDCTransaction.objects.exists()


def test_name_collision_does_not_link(monkeypatch):
    from user import oidc

    existing = Account.objects.create_user("oidc-collision", "password")
    values = iter(["collision", "unique"])
    monkeypatch.setattr(oidc.secrets, "token_hex", lambda _: next(values))
    account = resolve_account(ISSUER, "distinct-subject")
    assert account.pk != existing.pk
    assert account.name == "oidc-unique"
    assert not account.has_usable_password()


def test_missing_code_consumes_transaction(provider):
    browser = Client()
    state = begin(browser, provider)
    assert (
        browser.get(CALLBACK, {"state": state}).url == "/login/?oidc_error=1"
    )
    assert finish(browser, state).url == "/login/?oidc_error=1"
    assert provider["exchanges"] == 0


def test_provider_error_consumes_transaction(provider):
    browser = Client()
    state = begin(browser, provider)
    response = browser.get(
        CALLBACK,
        {
            "state": state,
            "error": "access_denied",
            "error_description": "SECRET",
        },
    )
    assert response.url == "/login/?oidc_error=1"
    assert finish(browser, state).url == "/login/?oidc_error=1"
    assert provider["exchanges"] == 0


def test_new_login_supersedes_old(provider):
    browser = Client()
    old = begin(browser, provider)
    new = begin(browser, provider)
    assert finish(browser, old).url == "/login/?oidc_error=1"
    assert finish(browser, new).url == "/channels/"


def test_unconfigured_local_recovery_and_logout(settings):
    settings.TA_OIDC_ISSUER = ""
    browser = Client(enforce_csrf_checks=True)
    assert (
        browser.get("/api/user/auth-options/").json()["oidc_enabled"] is False
    )
    assert browser.get("/api/user/oidc/login/").status_code == 404
    account = Account.objects.create_superuser("recovery", "password")
    assert (
        browser.post(
            "/api/user/login/",
            {"username": "recovery", "password": "password"},
        ).status_code
        == 204
    )
    assert int(browser.session["_auth_user_id"]) == account.pk
    assert browser.post("/api/user/logout/").status_code == 403
    from django.middleware.csrf import get_token
    from django.test import RequestFactory

    token = get_token(RequestFactory().get("/"))
    browser.cookies["csrftoken"] = token
    assert (
        browser.post("/api/user/logout/", HTTP_X_CSRFTOKEN=token).status_code
        == 204
    )
    assert "_auth_user_id" not in browser.session
