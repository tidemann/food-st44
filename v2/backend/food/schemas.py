from datetime import datetime
from typing import Literal

from ninja import ModelSchema, Schema
from pydantic import Field, field_validator
from pydantic_core import PydanticCustomError

from food import importer, photos, services
from food.models import Recipe
from food.tags import normalise as normalise_tags


def _required(value: str, message: str) -> str:
    value = value.strip()
    if not value:
        # A custom error keeps the message as written (no "Value error, " prefix).
        raise PydanticCustomError("required", message)
    return value


class RecipeIn(Schema):
    """Create and edit share one rule set (inventory §3.2). Values are stored trimmed."""

    title: str
    ingredients: str
    instructions: str = ""
    # Emneord (ST-784): the whole list, replacing the stored one. Stored as food.tags.normalise
    # leaves it, so "Middag " and "middag" are one tag.
    tags: list[str] = Field(default_factory=list)

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        return _required(value, "Tittelen må fylles ut.")

    @field_validator("ingredients")
    @classmethod
    def _ingredients(cls, value: str) -> str:
        return _required(value, "Skriv inn minst én ingrediens.")

    @field_validator("instructions")
    @classmethod
    def _instructions(cls, value: str) -> str:
        return value.strip()

    @field_validator("tags")
    @classmethod
    def _tags(cls, value: list[str]) -> list[str]:
        return normalise_tags(value)


class RecipeOut(ModelSchema):
    # Always present in a response. Declared here so the generated client types are required
    # fields, not the optional/nullable ones ModelSchema derives from the model's defaults.
    id: int
    instructions: str
    created_at: datetime
    # Where the photo is served (/photos/<name>), or null when the recipe has none.
    photo_url: str | None
    # Its emneord, lower case, in Norwegian order (Æ, Ø, Å last). Empty when it has none.
    tags: list[str]

    class Meta:
        model = Recipe
        fields = ("id", "title", "ingredients", "instructions", "created_at")

    @staticmethod
    def resolve_photo_url(obj: Recipe) -> str | None:
        return photos.url(obj)

    @staticmethod
    def resolve_tags(obj: Recipe) -> list[str]:
        return services.tag_names(obj)


class TagOut(Schema):
    """A tag in use, and how many recipes carry it."""

    name: str
    count: int


class PhotoReadingOut(Schema):
    # True when reading a recipe from a photo is switched on and the caller is an editor: the
    # SPA shows "Les oppskrift fra bilde" only then.
    available: bool


class LinkImportIn(Schema):
    # The page with the recipe. "matprat.no/…" without a scheme is taken as https://.
    url: str

    @field_validator("url")
    @classmethod
    def _url(cls, value: str) -> str:
        value = _required(value, importer.BAD_URL)
        return value if "://" in value else "https://" + value


class TextImportIn(Schema):
    # A recipe as plain text, pasted from another app.
    text: str

    @field_validator("text")
    @classmethod
    def _text(cls, value: str) -> str:
        value = _required(value, importer.NO_TEXT)
        if len(value) > importer.TEXT_MAX_CHARS:
            raise PydanticCustomError("too_long", importer.TEXT_TOO_LONG)
        return value


class RecipeDraftOut(Schema):
    """A recipe read from a photo, a link or pasted text, for the "Ny oppskrift" form to fill
    in. Nothing is saved: the editor checks it and saves it with POST /api/recipes like any
    other."""

    # False when no recipe could be read; the text fields are then empty.
    readable: bool
    title: str
    ingredients: str  # newline-separated, like RecipeIn
    instructions: str


class ErrorOut(Schema):
    detail: str


class ValidationErrors(Schema):
    """422 body: one message per field, keyed by field name, ready to show next to the input."""

    errors: dict[str, str]


class TextDraftOut(RecipeDraftOut):
    """The draft from pasted text: read by the AI provider when reading is on, else split by
    simple rules (food.importer.split_text), and the form says which."""

    # "ai" when the provider read it; "rules" when reading is off or the provider failed.
    read_by: Literal["ai", "rules"]
    # Why the rules were used, for the form; empty when read_by is "ai".
    notice: str
