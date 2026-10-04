import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from io import StringIO
from pathlib import Path

import pytest
from django.core.management import CommandError, call_command

from food.models import Recipe

pytestmark = pytest.mark.django_db

# The live site's table, verbatim from src/db.js.
V1_SCHEMA = """
  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    ingredients TEXT NOT NULL,
    instructions TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
"""


@pytest.fixture
def v1_db(tmp_path: Path) -> Path:
    """Three recipes added on the live site, then the newest (id 4) deleted again."""
    path = tmp_path / "recipes.db"
    with closing(sqlite3.connect(path)) as db:
        db.execute(V1_SCHEMA)
        db.executemany(
            "INSERT INTO recipes (id, title, ingredients, instructions, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            [
                (1, "Fårikål", "fårekjøtt\nkål", "Kok i tre timer.", "2026-01-05 17:30:00"),
                (3, "Sveler", "mel\nmelk", "", "2026-02-01 08:00:00"),
                (4, "Slettes", "x", "", "2026-03-01 08:00:00"),
            ],
        )
        db.execute("DELETE FROM recipes WHERE id = 4")
        db.commit()
    return path


def run_import(path: Path) -> str:
    out = StringIO()
    call_command("import_v1_recipes", str(path), stdout=out)
    return out.getvalue().strip()


def test_import_copies_ids_text_and_utc_dates(v1_db: Path) -> None:
    output = run_import(v1_db)

    assert output == "Added 2, skipped 0 (id already present). New recipes get id 5 and up."
    farikal, sveler = Recipe.objects.order_by("id")
    assert (farikal.id, farikal.title, farikal.ingredients, farikal.instructions) == (
        1,
        "Fårikål",
        "fårekjøtt\nkål",
        "Kok i tre timer.",
    )
    assert farikal.created_at == datetime(2026, 1, 5, 17, 30, tzinfo=UTC)
    assert (sveler.id, sveler.instructions) == (3, "")


def test_running_twice_adds_nothing(v1_db: Path) -> None:
    run_import(v1_db)

    output = run_import(v1_db)

    assert output == "Added 0, skipped 2 (id already present). New recipes get id 5 and up."
    assert Recipe.objects.count() == 2


def test_an_id_already_in_v2_is_left_alone(v1_db: Path) -> None:
    Recipe.objects.create(id=3, title="Mine", ingredients="x")

    output = run_import(v1_db)

    assert output.startswith("Added 1, skipped 1 ")
    assert Recipe.objects.get(pk=3).title == "Mine"


def test_new_recipes_continue_after_v1_ids_even_deleted_ones(v1_db: Path) -> None:
    run_import(v1_db)

    assert Recipe.objects.create(title="Ny", ingredients="x").id == 5


def test_sequence_continues_after_the_highest_copied_id(tmp_path: Path) -> None:
    path = tmp_path / "recipes.db"
    with closing(sqlite3.connect(path)) as db:
        db.execute(V1_SCHEMA)
        db.execute(
            "INSERT INTO recipes (id, title, ingredients, instructions) VALUES (9, 'a', 'b', '')"
        )
        db.commit()

    assert run_import(path).endswith("New recipes get id 10 and up.")
    assert Recipe.objects.create(title="Ny", ingredients="x").id == 10


def test_sequence_never_goes_backwards(v1_db: Path) -> None:
    Recipe.objects.create(id=20, title="Already here", ingredients="x")

    assert run_import(v1_db).endswith("New recipes get id 21 and up.")
    assert Recipe.objects.create(title="Ny", ingredients="x").id == 21


def test_missing_file_is_an_error(tmp_path: Path) -> None:
    with pytest.raises(CommandError, match="is not a file"):
        run_import(tmp_path / "nope.db")


def test_file_without_a_recipes_table_is_an_error(tmp_path: Path) -> None:
    path = tmp_path / "other.db"
    with closing(sqlite3.connect(path)) as db:
        db.execute("CREATE TABLE other (id INTEGER)")

    with pytest.raises(CommandError, match="cannot read the recipes table"):
        run_import(path)
