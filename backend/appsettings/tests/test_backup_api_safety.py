"""Online requests must never restore the shared application database."""

import pytest
from appsettings.src.backup import PostgreSQLBackup
from appsettings.views import (
    BackupApiView,
    BackupDownloadView,
    SnapshotApiListView,
    SnapshotApiView,
)
from rest_framework.test import APIRequestFactory, force_authenticate
from user.models import Account

pytestmark = pytest.mark.django_db


def test_online_restore_and_legacy_snapshots_fail_closed(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("online request attempted database restore")

    monkeypatch.setattr(PostgreSQLBackup, "restore", forbidden)
    user = Account.objects.create_superuser("admin", "password")
    request = APIRequestFactory().post("/", {})
    force_authenticate(request, user=user)
    response = BackupApiView.as_view()(request, filename="legacy.zip")
    assert response.status_code == 409
    assert "ta_restore_backup" in response.data["error"]
    assert SnapshotApiListView.as_view()(request).status_code == 410
    assert (
        SnapshotApiView.as_view()(request, snapshot_id="old").status_code
        == 410
    )


def test_backup_download_requires_admin_and_valid_filename(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(PostgreSQLBackup, "BACKUP_DIR", tmp_path)
    filename = "ta_backup-20261026T120000Z-manual.dump"
    (tmp_path / filename).write_bytes(b"PGDMP-native")
    factory = APIRequestFactory()
    request = factory.get("/")
    user = Account.objects.create_user("reader", "password")
    force_authenticate(request, user=user)
    assert (
        BackupDownloadView.as_view()(request, filename=filename).status_code
        == 403
    )
    user.is_staff = True
    user.save()
    response = BackupDownloadView.as_view()(request, filename=filename)
    assert response.status_code == 200
    assert b"".join(response.streaming_content) == b"PGDMP-native"
    response.close()
    assert (
        BackupDownloadView.as_view()(request, filename="../secret").status_code
        == 404
    )
