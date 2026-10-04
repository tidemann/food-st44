import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.db import connection, transaction

from food.models import Recipe


def _utc(value: str) -> datetime:
    """v1 stores SQLite CURRENT_TIMESTAMP: UTC as 'YYYY-MM-DD HH:MM:SS', without a zone."""
    parsed = datetime.fromisoformat(value)
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


class Command(BaseCommand):
    help = (
        "Copy recipes from the live site's SQLite file (its `recipes` table), keeping id and "
        "created_at. Recipes whose id is already here are skipped, so it is safe to run twice."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("path", help="the v1 database, e.g. /data/recipes.db")

    def handle(self, *args: object, **options: object) -> None:
        path = Path(str(options["path"]))
        if not path.is_file():
            raise CommandError(f"{path} is not a file")
        if connection.vendor != "sqlite":
            raise CommandError("the id sequence step only knows SQLite")

        rows, v1_sequence = self._read_v1(path)
        present = set(Recipe.objects.values_list("id", flat=True))
        try:
            new = [
                Recipe(
                    id=id_,
                    title=title,
                    ingredients=ingredients,
                    instructions=instructions,
                    created_at=_utc(created_at),
                )
                for id_, title, ingredients, instructions, created_at in rows
                if id_ not in present
            ]
        except ValueError as exc:
            raise CommandError(f"unreadable created_at in {path}: {exc}") from exc

        highest_copied = max((row[0] for row in rows), default=0)
        with transaction.atomic():
            Recipe.objects.bulk_create(new)
            last_id = self._continue_sequence_after(max(highest_copied, v1_sequence))

        self.stdout.write(
            f"Added {len(new)}, skipped {len(rows) - len(new)} (id already present). "
            f"New recipes get id {last_id + 1} and up."
        )

    def _read_v1(self, path: Path) -> tuple[list[tuple[int, str, str, str, str]], int]:
        """The v1 rows, oldest id first, and v1's AUTOINCREMENT counter (0 if it has none)."""
        with closing(sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)) as db:
            try:
                rows = db.execute(
                    "SELECT id, title, ingredients, instructions, created_at"
                    " FROM recipes ORDER BY id"
                ).fetchall()
            except sqlite3.DatabaseError as exc:
                raise CommandError(f"cannot read the recipes table in {path}: {exc}") from exc
            try:
                found = db.execute(
                    "SELECT seq FROM sqlite_sequence WHERE name = 'recipes'"
                ).fetchone()
            except sqlite3.OperationalError:  # no AUTOINCREMENT insert ever happened
                found = None
        return rows, int(found[0]) if found else 0

    def _continue_sequence_after(self, floor: int) -> int:
        """Make the next new recipe get an id above `floor`; return the last used id.

        `floor` covers v1's counter too, so the id of a recipe deleted on the live site is not
        handed out again (an old /recipes/<id> link must not open a different recipe).
        """
        table = Recipe._meta.db_table
        with connection.cursor() as cursor:
            cursor.execute("SELECT seq FROM sqlite_sequence WHERE name = %s", [table])
            found = cursor.fetchone()
            current = int(found[0]) if found else 0
            if found is None:
                cursor.execute(
                    "INSERT INTO sqlite_sequence (name, seq) VALUES (%s, %s)", [table, floor]
                )
            elif floor > current:
                cursor.execute(
                    "UPDATE sqlite_sequence SET seq = %s WHERE name = %s", [floor, table]
                )
        return max(current, floor)
