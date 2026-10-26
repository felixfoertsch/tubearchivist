"""Reject incompatible legacy database schemas before migrations."""

from django.core.management.base import BaseCommand, CommandError
from django.db import connection


class Command(BaseCommand):
    help = "Check for the incompatible pre-0.5.0 database layout"

    def handle(self, *args, **options):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = current_schema() AND table_name = %s)",
                ["home_account"],
            )
            legacy_layout = cursor.fetchone()[0]
        if legacy_layout:
            raise CommandError(
                "Database has incompatible legacy home_account table; follow "
                "the documented migration procedure before startup."
            )
        self.stdout.write(self.style.SUCCESS("Database layout check passed."))
