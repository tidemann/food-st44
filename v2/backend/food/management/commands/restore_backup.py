from datetime import UTC, datetime
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError, CommandParser

from food import backup


class Command(BaseCommand):
    help = (
        "Replace the database, photos and import markers with those in a backup archive. Stop "
        "the app first. What was there is saved as pre-restore-<time>.tar.gz next to the "
        "database; restoring that file undoes the restore."
    )
    requires_system_checks = ()

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("archive", help="a food-YYYY-MM-DD.tar.gz from the backup directory")

    def handle(self, *args: object, **options: object) -> None:
        archive = Path(str(options["archive"]))
        if not archive.is_file():
            raise CommandError(f"{archive} is not a file")
        try:
            saved = backup.restore(archive, datetime.now(UTC))
        except backup.FAILURES as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(f"restored {archive.name}")
        if saved:
            self.stdout.write(f"undo: python manage.py restore_backup {saved}")
