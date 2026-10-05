from datetime import datetime

from ninja import ModelSchema, Schema
from pydantic import field_validator
from pydantic_core import PydanticCustomError

from food import photos
from food.models import Recipe


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


class RecipeOut(ModelSchema):
    # Always present in a response. Declared here so the generated client types are required
    # fields, not the optional/nullable ones ModelSchema derives from the model's defaults.
    id: int
    instructions: str
    created_at: datetime
    # Where the photo is served (/photos/<name>), or null when the recipe has none.
    photo_url: str | None

    class Meta:
        model = Recipe
        fields = ("id", "title", "ingredients", "instructions", "created_at")

    @staticmethod
    def resolve_photo_url(obj: Recipe) -> str | None:
        return photos.url(obj)


class ErrorOut(Schema):
    detail: str


class ValidationErrors(Schema):
    """422 body: one message per field, keyed by field name, ready to show next to the input."""

    errors: dict[str, str]
