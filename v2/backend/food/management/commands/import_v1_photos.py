import re
import unicodedata
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError, CommandParser

from food import photos
from food.models import Recipe

# v1 (src/view-model.js) found a recipe's photo by file name: public/img/recipes/<slug>.<ext>.
EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")
_ASCII = str.maketrans({"æ": "ae", "ø": "o", "å": "a"})
_NON_SLUG = re.compile(r"[^a-z0-9]+")


def slugify(title: str) -> str:
    """v1's slugify: "Kjøttkaker i brun saus" → "kjottkaker-i-brun-saus"."""
    text = unicodedata.normalize("NFD", title.lower().translate(_ASCII))
    text = "".join(char for char in text if not unicodedata.combining(char))
    return _NON_SLUG.sub("-", text).strip("-")


class Command(BaseCommand):
    help = (
        "Give each recipe the v1 photo named after its title, as v1 matched them, through the "
        "same resize and clean-up as an upload. Recipes that already have a photo are left "
        "alone, so it is safe to run twice."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("path", help="v1's photo directory, e.g. public/img/recipes")

    def handle(self, *args: object, **options: object) -> None:
        directory = Path(str(options["path"]))
        if not directory.is_dir():
            raise CommandError(f"{directory} is not a directory")

        files = self._by_slug(directory)
        added = 0
        for recipe in Recipe.objects.filter(photo=""):
            source = files.get(slugify(recipe.title))
            if source is None:
                continue
            try:
                with source.open("rb") as file:
                    photos.save(recipe, file)
            except photos.PhotoError as exc:
                # One bad file must not stop the container from starting; say so and go on.
                self.stderr.write(f"{source.name}: {exc} Skipped recipe {recipe.pk}.")
                continue
            added += 1
            self.stdout.write(f"{source.name} → recipe {recipe.pk} ({recipe.title})")
        self.stdout.write(f"Added a photo to {added} recipe(s).")

    def _by_slug(self, directory: Path) -> dict[str, Path]:
        """The first file per slug in name order, like v1 (Node's readdir is sorted)."""
        found: dict[str, Path] = {}
        for file in sorted(directory.iterdir()):
            if file.is_file() and file.suffix.lower() in EXTENSIONS:
                found.setdefault(file.stem, file)
        return found
