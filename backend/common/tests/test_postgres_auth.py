"""PostgreSQL session and token authentication retain CSRF boundaries."""

import pytest
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient
from user.models import Account

pytestmark = pytest.mark.django_db


def test_session_write_requires_csrf_and_token_write_does_not():
    account = Account.objects.create_user("csrf-reader", "password")
    session = APIClient(enforce_csrf_checks=True)
    session.force_login(account)
    response = session.post("/api/watched/", {}, format="json")
    assert response.status_code == 403
    assert "CSRF" in str(response.data)

    token = Token.objects.create(user=account)
    client = APIClient(enforce_csrf_checks=True)
    client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    response = client.post("/api/watched/", {}, format="json")
    assert response.status_code == 400
    assert "CSRF" not in str(response.data)


def test_unauthenticated_reads_and_writes_denied():
    client = APIClient(enforce_csrf_checks=True)
    assert client.get("/api/video/").status_code in (401, 403)
    assert client.post("/api/watched/", {}, format="json").status_code in (
        401,
        403,
    )
