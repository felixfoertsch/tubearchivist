"""PostgreSQL backup contract tests."""

from types import SimpleNamespace

import pytest
from appsettings.src.backup import PostgreSQLBackup


def test_legacy_archive_is_not_exposed_as_restorable(tmp_path, monkeypatch):
    monkeypatch.setattr(PostgreSQLBackup, "BACKUP_DIR", tmp_path)
    (tmp_path / "ta_backup-20200101.zip").write_bytes(b"legacy")
    backup = PostgreSQLBackup()
    assert backup.get_all_backup_files() == []
    assert backup.build_backup_file_data("ta_backup-20200101.zip") is False


def test_backup_method_uses_native_name():
    assert callable(PostgreSQLBackup.create_backup)
    assert not hasattr(PostgreSQLBackup, "backup_all_indexes")


def test_web_restore_fails_closed_with_offline_action(tmp_path, monkeypatch):
    monkeypatch.setattr(PostgreSQLBackup, "BACKUP_DIR", tmp_path)
    with pytest.raises(RuntimeError, match="Web restore is disabled"):
        PostgreSQLBackup().restore("ta_backup-20260101T120000Z-manual.dump")


def test_automatic_rotation_preserves_configured_count_and_other_files(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(PostgreSQLBackup, "BACKUP_DIR", tmp_path)

    class ScheduleDoesNotExist(Exception):
        pass

    schedule = SimpleNamespace(task_config={"rotate": 2})
    manager = SimpleNamespace(
        get=lambda name: schedule if name == "run_backup" else None
    )
    model = type(
        "CustomPeriodicTask",
        (),
        {"objects": manager, "DoesNotExist": ScheduleDoesNotExist},
    )
    from django.apps import apps

    monkeypatch.setattr(apps, "get_model", lambda *args: model)
    monkeypatch.setattr(
        PostgreSQLBackup,
        "get_all_backup_files",
        lambda self: [
            data
            for path in sorted(tmp_path.iterdir(), reverse=True)
            if (data := self.build_backup_file_data(path.name))
        ],
    )

    for stamp in range(1, 5):
        (tmp_path / f"ta_backup-20260101T00000{stamp}Z-auto.dump").write_bytes(
            b"dump"
        )
    manual = tmp_path / "ta_backup-20260101T000005Z-manual.dump"
    legacy = tmp_path / "ta_backup-20200101.zip"
    linked = tmp_path / "ta_backup-20200101T000000Z-auto.dump"
    manual.write_bytes(b"manual")
    legacy.write_bytes(b"legacy")
    linked.symlink_to(manual)

    PostgreSQLBackup().rotate_backup()

    automatic = sorted(
        path.name
        for path in tmp_path.glob("*-auto.dump")
        if not path.is_symlink()
    )
    assert automatic == [
        "ta_backup-20260101T000003Z-auto.dump",
        "ta_backup-20260101T000004Z-auto.dump",
    ]
    assert manual.exists()
    assert legacy.exists()
    assert linked.is_symlink()
