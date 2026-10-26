"""PostgreSQL backups are managed with native pg_dump tools offline."""

import os
import re
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from common.src.env_settings import EnvironmentSettings


class PostgreSQLBackup:
    """Create native custom-format PostgreSQL backups."""

    BACKUP_DIR = Path(EnvironmentSettings.CACHE_DIR) / "backup"
    FILENAME = re.compile(
        r"^ta_backup-[0-9]{8}T[0-9]{6}Z-(auto|manual|update)\.dump$"
    )

    def __init__(self, reason=False, task=False):
        self.reason = reason
        self.task = task

    def create_backup(self):
        if not isinstance(self.reason, str) or self.reason not in {
            "auto",
            "manual",
            "update",
        }:
            raise ValueError("backup reason must be auto, manual, or update")
        version = subprocess.run(
            ["pg_dump", "--version"],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout.strip()
        if not re.search(r"\b18(?:\.\d+)?\b", version):
            raise RuntimeError(
                f"PostgreSQL 18 pg_dump required; found {version!r}"
            )
        self.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        with tempfile.NamedTemporaryFile(
            dir=self.BACKUP_DIR,
            prefix=f".{stamp}.",
            suffix=".dump",
            delete=False,
        ) as temporary:
            temp_path = Path(temporary.name)
        target = self.BACKUP_DIR / f"ta_backup-{stamp}-{self.reason}.dump"
        env = os.environ.copy()
        env["PGPASSWORD"] = EnvironmentSettings.POSTGRES_PASSWORD
        command = [
            "pg_dump",
            "--format=custom",
            "--no-owner",
            "--no-acl",
            "--exclude-extension=pg_trgm",
            "--host",
            EnvironmentSettings.POSTGRES_HOST,
            "--port",
            str(EnvironmentSettings.POSTGRES_PORT),
            "--username",
            EnvironmentSettings.POSTGRES_USER,
            "--dbname",
            EnvironmentSettings.POSTGRES_DB,
            "--file",
            str(temp_path),
        ]
        try:
            subprocess.run(command, env=env, check=True, timeout=3600)
            if not temp_path.is_file() or not temp_path.stat().st_size:
                raise RuntimeError(
                    "pg_dump completed without producing a non-empty backup"
                )
            os.link(temp_path, target)
            temp_path.unlink()
            if self.reason == "auto":
                self.rotate_backup()
        except Exception:
            temp_path.unlink(missing_ok=True)
            raise
        return str(target)

    def get_all_backup_files(self):
        self.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        return [
            data
            for path in sorted(self.BACKUP_DIR.iterdir(), reverse=True)
            if (data := self.build_backup_file_data(path.name))
        ]

    def build_backup_file_data(self, filename):
        if not isinstance(filename, str) or not self.FILENAME.fullmatch(
            filename
        ):
            return False
        path = self.BACKUP_DIR / filename
        if not path.is_file() or path.is_symlink():
            return False
        stamp, reason = (
            filename.removeprefix("ta_backup-")
            .removesuffix(".dump")
            .rsplit("-", 1)
        )
        return {
            "filename": filename,
            "file_path": str(path),
            "file_size": path.stat().st_size,
            "timestamp": stamp,
            "reason": reason,
        }

    def rotate_backup(self):
        """Rotate automatic dumps only when schedule sets a positive limit."""
        from django.apps import apps
        from django.core.exceptions import AppRegistryNotReady

        try:
            schedule_model = apps.get_model("task", "CustomPeriodicTask")
        except (LookupError, AppRegistryNotReady):
            return
        try:
            schedule = schedule_model.objects.get(name="run_backup")
        except schedule_model.DoesNotExist:
            return
        rotate = schedule.task_config.get("rotate")
        if (
            not isinstance(rotate, int)
            or isinstance(rotate, bool)
            or rotate < 1
        ):
            return
        automatic = sorted(
            (
                info
                for info in self.get_all_backup_files()
                if info["reason"] == "auto"
            ),
            key=lambda info: info["filename"],
            reverse=True,
        )
        for info in automatic[rotate:]:
            self.delete_file(info["filename"])

    def delete_file(self, filename):
        info = self.build_backup_file_data(filename)
        if not info:
            return False
        Path(info["file_path"]).unlink()
        return info["file_path"]

    def restore(self, filename):
        if not isinstance(filename, str) or not self.FILENAME.fullmatch(
            filename
        ):
            raise ValueError(
                "Legacy archives are unsupported; select a native PostgreSQL "
                ".dump backup"
            )
        command = (
            "docker compose run --rm --no-deps tubearchivist "
            "python manage.py ta_restore_backup "
            f"{filename} --target-database "
            f"{EnvironmentSettings.POSTGRES_DB} --quiesced"
        )
        raise RuntimeError(
            "Web restore is disabled. Stop web and Procrastinate workers; "
            "verify rollback backup, then run "
            f"`{command}`."
        )
