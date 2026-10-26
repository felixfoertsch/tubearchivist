"""Restore a native PostgreSQL dump during explicit offline maintenance."""

import os
import re
import shutil
import subprocess
from pathlib import Path

from common.src.env_settings import EnvironmentSettings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Restore native PostgreSQL backup during offline maintenance"

    def add_arguments(self, parser):
        parser.add_argument("filename")
        parser.add_argument("--quiesced", action="store_true")
        parser.add_argument("--target-database", required=True)

    def handle(self, *args, **options):
        path = self._validate_request(options)
        pg_restore, psql = self._tools()
        env = os.environ.copy()
        env["PGPASSWORD"] = EnvironmentSettings.POSTGRES_PASSWORD
        conn = [
            "--host",
            EnvironmentSettings.POSTGRES_HOST,
            "--port",
            str(EnvironmentSettings.POSTGRES_PORT),
            "--username",
            EnvironmentSettings.POSTGRES_USER,
            "--dbname",
            EnvironmentSettings.POSTGRES_DB,
        ]
        try:
            self._restore(path, pg_restore, psql, conn, env)
        except subprocess.CalledProcessError as err:
            raise CommandError(
                "PostgreSQL restore failed; inspect database state "
                "before retry"
            ) from err

    @staticmethod
    def _validate_request(options):
        if not options["quiesced"]:
            raise CommandError(
                "Stop TubeArchivist web and Procrastinate workers; pass "
                "--quiesced only after verifying no clients remain."
            )
        if options["target_database"] != EnvironmentSettings.POSTGRES_DB:
            raise CommandError(
                "--target-database must match configured POSTGRES_DB"
            )
        filename = options["filename"]
        if not isinstance(filename, str) or not re.fullmatch(
            r"ta_backup-[0-9]{8}T[0-9]{6}Z-(auto|manual|update)\.dump",
            filename,
        ):
            raise CommandError(
                "Invalid native backup filename; legacy ZIP/JSON archives are "
                "unsupported"
            )
        path = Path(EnvironmentSettings.CACHE_DIR) / "backup" / filename
        if not path.is_file() or path.is_symlink():
            raise CommandError(
                f"Backup not found or not a regular file: {filename}"
            )
        return path

    @staticmethod
    def _tools():
        pg_restore = shutil.which("pg_restore")
        psql = shutil.which("psql")
        if not pg_restore or not psql:
            raise CommandError(
                "pg_restore and psql must be installed in this container"
            )
        return pg_restore, psql

    @staticmethod
    def _restore(path, pg_restore, psql, conn, env):
        with path.open("rb") as dump:
            if dump.read(5) != b"PGDMP":
                raise CommandError(
                    "Backup is not a PostgreSQL custom-format dump; database "
                    "unchanged"
                )
        client_version = subprocess.run(
            [pg_restore, "--version"],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout.strip()
        if not re.search(r"\b18(?:\.\d+)?\b", client_version):
            raise CommandError(
                f"PostgreSQL 18 pg_restore required; found {client_version!r}"
            )
        version = subprocess.run(
            [
                psql,
                *conn,
                "--tuples-only",
                "--command",
                "SHOW server_version_num",
            ],
            env=env,
            check=True,
            capture_output=True,
            text=True,
            timeout=15,
        ).stdout.strip()
        if not version.isdigit() or int(version) // 10000 != 18:
            raise CommandError(
                "PostgreSQL 18 required for restore; "
                f"target reports {version!r}"
            )
        clients = subprocess.run(
            [
                psql,
                *conn,
                "--tuples-only",
                "--command",
                "SELECT count(*) FROM pg_stat_activity "
                "WHERE datname = current_database() "
                "AND pid <> pg_backend_pid()",
            ],
            env=env,
            check=True,
            capture_output=True,
            text=True,
            timeout=15,
        ).stdout.strip()
        if clients != "0":
            raise CommandError(
                f"Restore refused: {clients} other database client(s) "
                "connected; stop web, workers, and scheduler"
            )
        subprocess.run(
            [pg_restore, "--list", str(path)],
            env=env,
            check=True,
            capture_output=True,
            timeout=30,
        )
        subprocess.run(
            [
                pg_restore,
                "--clean",
                "--if-exists",
                "--single-transaction",
                "--exit-on-error",
                "--no-owner",
                "--no-acl",
                *conn,
                str(path),
            ],
            env=env,
            check=True,
            timeout=3600,
        )
