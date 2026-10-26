"""Bounded PostgreSQL readiness check before migrations."""

from time import monotonic, sleep

from django.core.management.base import BaseCommand, CommandError
from django.db import connection


class Command(BaseCommand):
    """command framework"""

    TIMEOUT = 120
    help = "Check connections"

    def handle(self, *args, **options):
        self._postgres_connection_check()

    def _postgres_connection_check(self):
        self.stdout.write("[3] connect to PostgreSQL")
        deadline = monotonic() + self.TIMEOUT
        last_error = None
        while monotonic() < deadline:
            try:
                connection.ensure_connection()
                with connection.cursor() as cursor:
                    cursor.execute("SHOW server_version_num")
                    major = int(cursor.fetchone()[0]) // 10000
                if major != 18:
                    raise CommandError(
                        f"PostgreSQL 18 required; server reports major {major}"
                    )
                self.stdout.write(
                    self.style.SUCCESS(
                        "    ✓ PostgreSQL 18 connection established"
                    )
                )
                return
            except CommandError:
                raise
            except Exception as err:
                last_error = err
                sleep(min(2, max(0, deadline - monotonic())))
        raise CommandError(
            "PostgreSQL connection failed after 120 seconds; check "
            "POSTGRES_HOST/PORT "
            f"and database credentials ({type(last_error).__name__})"
        )
