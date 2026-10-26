"""Concurrent first logins cannot orphan or duplicate federated accounts."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.db import close_old_connections
from user import oidc
from user.models import Account, FederatedIdentity


@pytest.mark.django_db(transaction=True)
def test_concurrent_first_login(monkeypatch):
    barrier = Barrier(2)
    original = oidc.new_account

    def synchronize():
        barrier.wait(timeout=10)
        return original()

    monkeypatch.setattr(oidc, "new_account", synchronize)

    def login_once():
        close_old_connections()
        try:
            return oidc.resolve_account(
                "https://identity.example/", "same-subject"
            ).pk
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        ids = list(pool.map(lambda _: login_once(), range(2)))
    assert ids[0] == ids[1]
    assert Account.objects.count() == 1
    assert FederatedIdentity.objects.count() == 1
