"""Opt-in native PostgreSQL backup/restore integration test.

Run with PostgreSQL 18 available and PG_ADMIN_USER/PG_ADMIN_DB configured:
POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=55438 POSTGRES_USER=ta_app \
POSTGRES_PASSWORD=dev TA_PASSWORD=dev TA_USERNAME=dev \
PG_ADMIN_USER=ta_dev_admin PG_ADMIN_DB=postgres \
.venv/bin/python -m pytest \
  appsettings/tests/test_postgres_backup_integration.py -v
"""

import os
import subprocess
import sys
import uuid
from contextlib import closing
from pathlib import Path

import pytest


def test_native_backup_restore_roundtrip_isolated_database(tmp_path):
    required = ("PG_ADMIN_USER", "PG_ADMIN_DB", "POSTGRES_PASSWORD")
    if any(not os.environ.get(name) for name in required):
        pytest.skip("disposable PostgreSQL admin configuration required")
    from common.src.env_settings import EnvironmentSettings

    db = f"ta_backup_review_{uuid.uuid4().hex[:12]}"
    admin = [
        "psql",
        "--no-psqlrc",
        "--host",
        EnvironmentSettings.POSTGRES_HOST,
        "--port",
        str(EnvironmentSettings.POSTGRES_PORT),
        "--username",
        os.environ["PG_ADMIN_USER"],
        "--dbname",
        os.environ["PG_ADMIN_DB"],
        "--no-password",
        "--tuples-only",
        "--no-align",
        "--command",
    ]
    env = os.environ.copy()
    env["PGPASSWORD"] = os.environ.get(
        "PG_ADMIN_PASSWORD", EnvironmentSettings.POSTGRES_PASSWORD
    )
    try:
        subprocess.run(
            admin + [f'CREATE DATABASE "{db}" OWNER ta_app'],
            env=env,
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
        subprocess.run(
            admin[:-6]
            + [
                "--dbname",
                db,
                "--no-password",
                "--command",
                "CREATE EXTENSION pg_trgm",
            ],
            env=env,
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
        app_env = env | {
            "POSTGRES_DB": db,
            "TA_CACHE_DIR": str(tmp_path),
            "PGPASSWORD": EnvironmentSettings.POSTGRES_PASSWORD,
        }
        repo = Path(__file__).resolve().parents[2]
        manage = [sys.executable, "manage.py"]
        subprocess.run(
            manage + ["migrate", "--noinput"],
            cwd=repo,
            env=app_env,
            check=True,
            capture_output=True,
            text=True,
            timeout=120,
        )
        sql = admin[:]
        sql[sql.index(os.environ["PG_ADMIN_USER"])] = "ta_app"
        sql[sql.index(os.environ["PG_ADMIN_DB"])] = db
        sql_env = app_env.copy()
        sql_env["PGPASSWORD"] = EnvironmentSettings.POSTGRES_PASSWORD
        subprocess.run(
            sql
            + [
                "CREATE TABLE backup_fixture (value text); "
                "INSERT INTO backup_fixture VALUES ('before')"
            ],
            env=sql_env,
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
        created = (
            subprocess.run(
                [
                    sys.executable,
                    "-c",
                    "from appsettings.src.backup import PostgreSQLBackup; "
                    "print(PostgreSQLBackup(reason='manual').create_backup())",
                ],
                cwd=repo,
                env=app_env,
                check=True,
                capture_output=True,
                text=True,
                timeout=60,
            )
            .stdout.strip()
            .splitlines()[-1]
        )
        dump = Path(created)
        assert dump.is_file() and dump.read_bytes()[:5] == b"PGDMP"
        subprocess.run(
            sql + ["UPDATE backup_fixture SET value='after'"],
            env=sql_env,
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
        # A dependent view makes pg_restore --clean fail after it has begun
        # dropping objects; --single-transaction must retain all target state.
        subprocess.run(
            sql
            + [
                "CREATE VIEW backup_fixture_guard AS "
                "SELECT value FROM backup_fixture"
            ],
            env=sql_env,
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
        failed_restore = subprocess.run(
            manage
            + [
                "ta_restore_backup",
                dump.name,
                "--target-database",
                db,
                "--quiesced",
            ],
            cwd=repo,
            env=app_env,
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert failed_restore.returncode != 0
        assert "PostgreSQL restore failed" in failed_restore.stderr
        rollback_state = subprocess.run(
            sql
            + [
                "SELECT value FROM backup_fixture; "
                "SELECT count(*) FROM backup_fixture_guard"
            ],
            env=sql_env,
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        ).stdout.splitlines()
        assert rollback_state == ["after", "1"]
        subprocess.run(
            sql + ["DROP VIEW backup_fixture_guard"],
            env=sql_env,
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
        # CLI validates quiescence and invokes native pg_restore.
        subprocess.run(
            manage
            + [
                "ta_restore_backup",
                dump.name,
                "--target-database",
                db,
                "--quiesced",
            ],
            cwd=repo,
            env=app_env,
            check=True,
            capture_output=True,
            text=True,
            timeout=120,
        )
        restored = subprocess.run(
            sql + ["SELECT value FROM backup_fixture"],
            env=sql_env,
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        ).stdout.strip()
        assert restored == "before"
        # Refusal paths must leave database contents untouched.
        import psycopg

        with closing(
            psycopg.connect(
                host=EnvironmentSettings.POSTGRES_HOST,
                port=EnvironmentSettings.POSTGRES_PORT,
                dbname=db,
                user=EnvironmentSettings.POSTGRES_USER,
                password=EnvironmentSettings.POSTGRES_PASSWORD,
                connect_timeout=5,
            )
        ):
            active_client = subprocess.run(
                manage
                + [
                    "ta_restore_backup",
                    dump.name,
                    "--target-database",
                    db,
                    "--quiesced",
                ],
                cwd=repo,
                env=app_env,
                capture_output=True,
                text=True,
                timeout=30,
            )
        assert active_client.returncode != 0
        assert "other database client(s) connected" in active_client.stderr
        for args, expected in (
            (
                [dump.name, "--target-database", "other", "--quiesced"],
                "must match configured POSTGRES_DB",
            ),
            (
                [
                    "ta_backup-20200101.zip",
                    "--target-database",
                    db,
                    "--quiesced",
                ],
                "unsupported",
            ),
            ([dump.name, "--target-database", db], "Stop TubeArchivist"),
        ):
            result = subprocess.run(
                manage + ["ta_restore_backup"] + args,
                cwd=repo,
                env=app_env,
                capture_output=True,
                text=True,
                timeout=30,
            )
            assert result.returncode != 0 and expected in result.stderr
        assert (
            subprocess.run(
                sql + ["SELECT value FROM backup_fixture"],
                env=sql_env,
                check=True,
                capture_output=True,
                text=True,
                timeout=20,
            ).stdout.strip()
            == "before"
        )
    finally:
        cleanup_env = env.copy()
        subprocess.run(
            admin + [f'DROP DATABASE IF EXISTS "{db}" WITH (FORCE)'],
            env=cleanup_env,
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
