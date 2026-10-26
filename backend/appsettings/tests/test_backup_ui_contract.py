"""Native backup HTTP payload stays compatible with modern browser UI."""

import pytest
from appsettings.src.backup import PostgreSQLBackup
from rest_framework.test import APIClient
from user.models import Account

pytestmark = pytest.mark.django_db


def test_backup_list_and_head_download_contract(tmp_path, monkeypatch):
    monkeypatch.setattr(PostgreSQLBackup, "BACKUP_DIR", tmp_path)
    filename = "ta_backup-20261026T120000Z-manual.dump"
    (tmp_path / filename).write_bytes(b"PGDMP-native")
    client = APIClient()
    url = f"/api/appsettings/backup/{filename}/download/"
    assert client.head(url).status_code in (401, 403)
    reader = Account.objects.create_user("reader", "password")
    client.force_authenticate(reader)
    assert client.head(url).status_code == 403
    reader.is_staff = True
    reader.save()
    listing = client.get("/api/appsettings/backup/")
    assert listing.status_code == 200
    assert listing.json() == [
        {
            "filename": filename,
            "file_path": str(tmp_path / filename),
            "file_size": 12,
            "timestamp": "20261026T120000Z",
            "reason": "manual",
        }
    ]
    response = client.head(url)
    assert response.status_code == 200
    assert response["Content-Length"] == "12"
    assert (
        response["Content-Disposition"] == f'attachment; filename="{filename}"'
    )
    assert b"".join(response.streaming_content) == b""
    response.close()
    assert (
        client.head(url.replace(filename, "missing.dump")).status_code == 404
    )
