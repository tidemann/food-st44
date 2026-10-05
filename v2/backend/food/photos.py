"""Recipe photos: at most one per recipe, a file in settings.PHOTOS_DIR, served at /photos/<name>.

Every photo goes through `prepare` on its way in, whether an editor uploads it or
import_v1_photos moves it over: the content (not the file name) must be JPEG, PNG or WebP; the
picture is turned upright from its EXIF orientation, shrunk to LONG_EDGE on its long side and
written as WebP without EXIF or XMP (no GPS position, camera or time). The colour profile stays,
or a phone's wide-gamut photo would look washed out. Each save gets a new file name, so a photo
URL never changes what it shows and browsers may cache it for good.
"""

import re
import secrets
from io import BytesIO
from pathlib import Path
from typing import IO

from django.conf import settings
from django.db import transaction
from PIL import Image, ImageOps, UnidentifiedImageError

from food.models import Recipe

URL_PREFIX = "/photos/"
LONG_EDGE = 1600  # px: sharp on a phone and on the desktop recipe page, a few hundred kB as WebP
QUALITY = 80
# Pillow's names for what we take. MPO is the JPEG some phones write: a JPEG with a second image
# (depth map, preview) appended. Only the first is used.
FORMATS = frozenset({"JPEG", "MPO", "PNG", "WEBP"})
_NAME = re.compile(r"[0-9]+-[0-9a-f]{16}\.webp")

NOT_AN_IMAGE = "Filen er ikke et bilde. Velg et JPEG-, PNG- eller WEBP-bilde."
TOO_LARGE = (
    f"Bildet er for stort. Velg et bilde under {settings.PHOTO_MAX_UPLOAD_BYTES // 2**20} MB."
)


class PhotoError(ValueError):
    """Not a photo we take. The message is for the person who chose the file."""


def url(recipe: Recipe) -> str | None:
    return URL_PREFIX + recipe.photo if recipe.photo else None


def path(name: str) -> Path | None:
    """The stored file called `name`, or None. Only names `save` makes, so no path tricks."""
    if not _NAME.fullmatch(name):
        return None
    found = settings.PHOTOS_DIR / name
    return found if found.is_file() else None


def prepare(source: IO[bytes]) -> bytes:
    """The photo as we store it. PhotoError if `source` is not a JPEG, PNG or WebP image."""
    try:
        with Image.open(source) as image:
            if image.format not in FORMATS:
                raise PhotoError(NOT_AN_IMAGE)
            icc_profile = image.info.get("icc_profile")
            # JPEG only (a no-op otherwise): decode at a fraction of full size when that still
            # covers LONG_EDGE. A 50-megapixel phone photo then never needs ~150 MB of memory.
            image.draft("RGB", (LONG_EDGE, LONG_EDGE))
            upright = ImageOps.exif_transpose(image)
            picture = upright.convert("RGBA" if upright.has_transparency_data else "RGB")
    except PhotoError:
        raise
    except Image.DecompressionBombError as exc:  # over ~179 megapixels
        raise PhotoError(TOO_LARGE) from exc
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        # Not an image at all, or one too damaged to decode.
        raise PhotoError(NOT_AN_IMAGE) from exc

    picture.thumbnail((LONG_EDGE, LONG_EDGE), Image.Resampling.LANCZOS)
    picture.info.clear()  # nothing from the original rides along: no EXIF, no XMP
    out = BytesIO()
    picture.save(out, "WEBP", quality=QUALITY, icc_profile=icc_profile or b"")
    return out.getvalue()


def save(recipe: Recipe, source: IO[bytes]) -> Recipe:
    """Give `recipe` this photo in place of any it had. PhotoError if it is not one we take."""
    data = prepare(source)
    settings.PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{recipe.pk}-{secrets.token_hex(8)}.webp"
    (settings.PHOTOS_DIR / name).write_bytes(data)
    _set(recipe, name)
    return recipe


def remove(recipe: Recipe) -> Recipe:
    """Take the recipe's photo away, if it has one."""
    _set(recipe, "")
    return recipe


def forget(recipe: Recipe) -> None:
    """The recipe is being deleted: its photo file goes once that is committed."""
    _delete_after_commit(recipe.photo)


def _set(recipe: Recipe, name: str) -> None:
    old = recipe.photo
    recipe.photo = name
    recipe.save(update_fields=["photo"])
    _delete_after_commit(old)


def _delete_after_commit(name: str) -> None:
    # After the commit, so a rolled-back change never points at a file that is gone.
    if name:
        transaction.on_commit(lambda: _delete(name))


def _delete(name: str) -> None:
    found = path(name)
    if found is not None:
        found.unlink(missing_ok=True)
