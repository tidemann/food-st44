"""Backups of the data volume: the database, the recipe photos and the one-time import markers.

One archive per day, `food-YYYY-MM-DD.tar.gz` (UTC date), in a directory that holds the marker
file TARGET_MARKER. The marker is what says "this is the backup disk": on spzmf the directory
is the NAS, and if the NAS is not mounted the path is an empty local directory without it, so
nothing is written to the app disk by mistake.

The database is copied with SQLite's online backup API, never as a raw file, so a write in
progress cannot leave a torn copy. The secret key is left out: the archive sits on a shared
disk, and a restore without it only means a new key (everyone signs in again).
"""

import re
import shutil
import sqlite3
import tarfile
import tempfile
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

from django.conf import settings

TARGET_MARKER = ".food-backup-target"
KEEP = 14
DATABASE = "food.sqlite3"
PHOTOS = "photos"
# Written by docker-entrypoint.sh. Restored with the data, or a restore onto an empty volume would
# import the v1 recipes and photos a second time.
MARKERS = ("v1-imported", "v1-photos-imported")
_ARCHIVE = re.compile(r"food-[0-9]{4}-[0-9]{2}-[0-9]{2}\.tar\.gz")
_PHOTO_MEMBER = re.compile(rf"{PHOTOS}/[^/]+")


class BackupError(Exception):
    """The backup or restore did not happen; the message says why."""


# What a backup or restore can fail with, short of a bug: ours, the disk, the archive, SQLite.
FAILURES = (BackupError, OSError, tarfile.TarError, sqlite3.Error)


def database_path() -> Path:
    return Path(str(settings.DATABASES["default"]["NAME"]))


def archive_name(now: datetime) -> str:
    return f"food-{now.astimezone(UTC):%Y-%m-%d}.tar.gz"


def archives(dest: Path) -> list[Path]:
    """The backups in `dest`, oldest first."""
    return sorted(path for path in dest.iterdir() if _ARCHIVE.fullmatch(path.name))


def check_target(dest: Path) -> None:
    if not (dest / TARGET_MARKER).is_file():
        raise BackupError(
            f"{dest} has no {TARGET_MARKER}, so it is not the backup disk (is the NAS mounted?). "
            "Nothing written."
        )


def _integrity(path: Path) -> None:
    with closing(sqlite3.connect(path)) as db:
        result = db.execute("PRAGMA integrity_check").fetchone()
    if result != ("ok",):
        raise BackupError(f"{path.name}: integrity check failed: {result}")


def write_archive(archive: Path, *, read_only: bool = True) -> None:
    """The data volume as it is now, into `archive` (replaced atomically if it exists).

    `read_only`: the nightly backup runs on a read-only mount and must never write the live
    database. A restore (app stopped) opens it normally, so a journal left by a crash is rolled
    back first and the saved copy is the last committed state.
    """
    source = database_path()
    if not source.is_file():
        raise BackupError(f"no database at {source}")
    mode = "ro" if read_only else "rw"
    with tempfile.TemporaryDirectory() as work:
        copy = Path(work) / DATABASE
        with (
            closing(sqlite3.connect(f"file:{source}?mode={mode}", uri=True)) as live,
            closing(sqlite3.connect(copy)) as target,
        ):
            live.backup(target)
        _integrity(copy)

        partial = archive.with_name(f".{archive.name}.partial")
        with tarfile.open(partial, "w:gz") as tar:
            tar.add(copy, arcname=DATABASE)
            if settings.PHOTOS_DIR.is_dir():
                for photo in sorted(settings.PHOTOS_DIR.iterdir()):
                    if photo.is_file():
                        tar.add(photo, arcname=f"{PHOTOS}/{photo.name}")
            for marker in MARKERS:
                if (source.parent / marker).is_file():
                    tar.add(source.parent / marker, arcname=marker)
        partial.replace(archive)


def backup(dest: Path, now: datetime, keep: int = KEEP) -> Path:
    """Today's archive in `dest`, then only the newest `keep` archives are kept."""
    check_target(dest)
    archive = dest / archive_name(now)
    write_archive(archive)
    for old in archives(dest)[:-keep]:
        old.unlink()
    return archive


def _member_name(member: tarfile.TarInfo) -> str:
    name = member.name
    if not member.isfile() or not (
        name == DATABASE or name in MARKERS or _PHOTO_MEMBER.fullmatch(name)
    ):
        raise BackupError(f"not a food backup: unexpected entry {name!r}")
    return name


def restore(archive: Path, now: datetime) -> Path | None:
    """Replace the database, photos and markers with those in `archive`. Run with the app stopped.

    What was there first is saved as `pre-restore-<time>.tar.gz` next to the database and that
    path returned (None on an empty volume), so the restore can be undone by restoring that file.
    """
    db = database_path()
    data = db.parent
    with tempfile.TemporaryDirectory(dir=data) as work:
        staged = Path(work)
        with tarfile.open(archive, "r:gz") as tar:
            members = tar.getmembers()
            names = [_member_name(member) for member in members]
            if DATABASE not in names:
                raise BackupError(f"not a food backup: no {DATABASE} in {archive.name}")
            tar.extractall(staged, members=members, filter="data")
        _integrity(staged / DATABASE)

        saved = None
        if db.is_file():
            saved = data / f"pre-restore-{now.astimezone(UTC):%Y%m%dT%H%M%SZ}.tar.gz"
            write_archive(saved, read_only=False)

        # A journal left by a crash would be rolled into the restored file on the next open.
        for leftover in (db.with_name(db.name + "-journal"), db.with_name(db.name + "-wal")):
            leftover.unlink(missing_ok=True)
        (staged / DATABASE).replace(db)
        shutil.rmtree(settings.PHOTOS_DIR, ignore_errors=True)
        settings.PHOTOS_DIR.mkdir(parents=True)
        if (staged / PHOTOS).is_dir():
            for photo in (staged / PHOTOS).iterdir():
                shutil.move(photo, settings.PHOTOS_DIR / photo.name)
        for marker in MARKERS:
            if (staged / marker).is_file():
                (staged / marker).replace(data / marker)
            else:
                (data / marker).unlink(missing_ok=True)
    return saved
