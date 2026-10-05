import time
from datetime import UTC, datetime
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError, CommandParser

from food import backup

# How often --nightly looks whether today's archive is there. It is made in the first hour after
# 00:00 UTC, and an attempt that failed (NAS away) is retried the hour after.
CHECK_EVERY = 3600


class Command(BaseCommand):
    help = (
        "Write today's backup of the data volume (database, photos, import markers) to DEST as "
        f"food-YYYY-MM-DD.tar.gz and keep the newest {backup.KEEP}. DEST must hold "
        f"{backup.TARGET_MARKER}. With --nightly, keep running and make one each day."
    )
    # Runs in its own container next to the app; nothing here needs the system checks.
    requires_system_checks = ()

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("dest", help="the backup directory, e.g. /backups")
        parser.add_argument(
            "--nightly",
            action="store_true",
            help="run until stopped: make today's archive whenever it is missing",
        )

    def handle(self, *args: object, **options: object) -> None:
        dest = Path(str(options["dest"]))
        if not options["nightly"]:
            try:
                self._backup(dest)
            except backup.FAILURES as exc:
                raise CommandError(str(exc)) from exc
            return
        while True:
            # Logged and retried, never raised: the container keeps going, and the next check
            # tries again.
            try:
                if not (dest / backup.archive_name(datetime.now(UTC))).is_file():
                    self._backup(dest)
            except backup.FAILURES as exc:
                self.stderr.write(f"backup failed: {exc}")
            time.sleep(CHECK_EVERY)

    def _backup(self, dest: Path) -> None:
        archive = backup.backup(dest, datetime.now(UTC))
        self.stdout.write(f"backup: {archive} ({archive.stat().st_size} bytes)")
