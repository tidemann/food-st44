import io
import sqlite3
import tarfile
from collections.abc import Iterator
from contextlib import closing
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from django.core.management import CommandError, call_command
from django.test.utils import override_settings

from food import backup

NOW = datetime(2026, 10, 6, 0, 30, tzinfo=UTC)


@pytest.fixture
def data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """A data volume as the app leaves it: database, photos, the v1 import marker."""
    volume = tmp_path / "data"
    volume.mkdir()
    db = volume / "food.sqlite3"
    with closing(sqlite3.connect(db)) as conn, conn:
        conn.execute("CREATE TABLE recipe (id INTEGER PRIMARY KEY, title TEXT)")
        conn.execute("INSERT INTO recipe (title) VALUES ('Fårikål'), ('Sveler')")
    (volume / "photos").mkdir()
    (volume / "photos/1-aaaa.webp").write_bytes(b"one")
    (volume / "photos/2-bbbb.webp").write_bytes(b"two")
    (volume / "v1-imported").write_text("2026-10-01T00:00:00Z\n")
    (volume / "secret_key").write_text("do-not-copy")
    monkeypatch.setattr(backup, "database_path", lambda: db)
    with override_settings(PHOTOS_DIR=volume / "photos"):
        yield volume


@pytest.fixture
def dest(tmp_path: Path) -> Path:
    target = tmp_path / "backups"
    target.mkdir()
    (target / backup.TARGET_MARKER).touch()
    return target


def titles(volume: Path) -> list[str]:
    with closing(sqlite3.connect(volume / "food.sqlite3")) as conn:
        return [row[0] for row in conn.execute("SELECT title FROM recipe ORDER BY id")]


def members(archive: Path) -> list[str]:
    with tarfile.open(archive) as tar:
        return sorted(tar.getnames())


def test_backup_holds_database_photos_and_markers_but_not_the_secret(
    data: Path, dest: Path
) -> None:
    archive = backup.backup(dest, NOW)

    assert archive == dest / "food-2026-10-06.tar.gz"
    assert members(archive) == [
        "food.sqlite3",
        "photos/1-aaaa.webp",
        "photos/2-bbbb.webp",
        "v1-imported",
    ]
    assert not list(dest.glob(".*.partial"))


def test_backup_copies_only_committed_data(data: Path, dest: Path) -> None:
    # A write in progress in the app: holds the write lock, not yet committed.
    with closing(sqlite3.connect(data / "food.sqlite3", isolation_level=None)) as app:
        app.execute("BEGIN IMMEDIATE")
        app.execute("INSERT INTO recipe (title) VALUES ('Halvskrevet')")
        archive = backup.backup(dest, NOW)
        app.execute("ROLLBACK")

    with tarfile.open(archive) as tar:
        tar.extract("food.sqlite3", dest / "check", filter="data")
    with closing(sqlite3.connect(dest / "check/food.sqlite3")) as conn:
        assert [r[0] for r in conn.execute("SELECT title FROM recipe")] == ["Fårikål", "Sveler"]


def test_backup_refuses_a_directory_without_the_marker(data: Path, dest: Path) -> None:
    (dest / backup.TARGET_MARKER).unlink()

    with pytest.raises(backup.BackupError, match="not the backup disk"):
        backup.backup(dest, NOW)
    assert list(dest.iterdir()) == []


def test_backup_keeps_the_newest_fourteen(data: Path, dest: Path) -> None:
    for days in range(1, 16):
        (dest / backup.archive_name(NOW - timedelta(days=days))).write_bytes(b"old")
    (dest / "notes.txt").write_text("not ours")

    backup.backup(dest, NOW)

    kept = [path.name for path in backup.archives(dest)]
    assert len(kept) == 14
    assert kept[0] == "food-2026-09-23.tar.gz"
    assert kept[-1] == "food-2026-10-06.tar.gz"
    assert (dest / "notes.txt").exists()


def test_restore_brings_the_data_back_and_can_be_undone(data: Path, dest: Path) -> None:
    archive = backup.backup(dest, NOW)
    # Then things go wrong: a recipe deleted, a photo lost, another added, a stale journal.
    with closing(sqlite3.connect(data / "food.sqlite3")) as conn, conn:
        conn.execute("DELETE FROM recipe WHERE title = 'Sveler'")
    (data / "photos/2-bbbb.webp").unlink()
    (data / "photos/3-cccc.webp").write_bytes(b"three")
    (data / "food.sqlite3-journal").write_bytes(b"stale")

    saved = backup.restore(archive, NOW + timedelta(hours=1))

    assert titles(data) == ["Fårikål", "Sveler"]
    assert sorted(p.name for p in (data / "photos").iterdir()) == ["1-aaaa.webp", "2-bbbb.webp"]
    assert (data / "v1-imported").exists()
    assert not (data / "food.sqlite3-journal").exists()
    assert (data / "secret_key").read_text() == "do-not-copy"
    assert saved == data / "pre-restore-20261006T013000Z.tar.gz"

    backup.restore(saved, NOW + timedelta(hours=2))

    assert titles(data) == ["Fårikål"]
    assert sorted(p.name for p in (data / "photos").iterdir()) == ["1-aaaa.webp", "3-cccc.webp"]


def test_restore_onto_an_empty_volume(data: Path, dest: Path) -> None:
    archive = backup.backup(dest, NOW)
    for path in (data / "food.sqlite3", data / "v1-imported"):
        path.unlink()
    for photo in (data / "photos").iterdir():
        photo.unlink()
    (data / "photos").rmdir()

    assert backup.restore(archive, NOW) is None
    assert titles(data) == ["Fårikål", "Sveler"]
    assert (data / "v1-imported").exists()


def test_restore_refuses_an_archive_that_is_not_a_backup(data: Path, tmp_path: Path) -> None:
    evil = tmp_path / "evil.tar.gz"
    with tarfile.open(evil, "w:gz") as tar:
        tar.add(data / "food.sqlite3", arcname="food.sqlite3")
        info = tarfile.TarInfo("../outside")
        info.size = 1
        tar.addfile(info, io.BytesIO(b"x"))

    with pytest.raises(backup.BackupError, match="unexpected entry"):
        backup.restore(evil, NOW)
    assert not (tmp_path / "outside").exists()
    assert titles(data) == ["Fårikål", "Sveler"]


def test_commands(data: Path, dest: Path) -> None:
    out = io.StringIO()
    call_command("backup", str(dest), stdout=out)
    (archive,) = backup.archives(dest)
    assert f"backup: {archive}" in out.getvalue()

    out = io.StringIO()
    call_command("restore_backup", str(archive), stdout=out)
    assert "undo: python manage.py restore_backup" in out.getvalue()

    (dest / backup.TARGET_MARKER).unlink()
    with pytest.raises(CommandError, match="not the backup disk"):
        call_command("backup", str(dest))
    with pytest.raises(CommandError, match="is not a file"):
        call_command("restore_backup", str(dest / "missing.tar.gz"))
