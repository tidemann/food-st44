from datetime import date, datetime
from typing import Any, Literal, Self

from ninja import ModelSchema, Schema
from pydantic import (
    Field,
    ModelWrapValidatorHandler,
    ValidationError,
    field_validator,
    model_validator,
)
from pydantic_core import InitErrorDetails, PydanticCustomError

from food import description, importer, photos, services, structure
from food.models import Recipe
from food.tags import normalise as normalise_tags


def _required(value: str, message: str) -> str:
    value = value.strip()
    if not value:
        # A custom error keeps the message as written (no "Value error, " prefix).
        raise PydanticCustomError("required", message)
    return value


class GroupIn(Schema):
    """One ingredient group (ST-1962). The title may be empty only when it is the only group."""

    title: str = ""
    ingredients: str = ""  # one per line

    @field_validator("title", "ingredients")
    @classmethod
    def _trim(cls, value: str) -> str:
        return value.strip()


class PhaseIn(Schema):
    """One phase of the method (ST-1962): a title, an optional time, at least one step."""

    title: str = ""
    time: str = ""  # «3 timer på 110-120 °C»; optional
    instructions: str = ""  # one paragraph per step

    @field_validator("title", "time", "instructions")
    @classmethod
    def _trim(cls, value: str) -> str:
        return value.strip()


class RecipeStructure(Schema):
    """The ingredients as one list (`ingredients`) or as groups (`ingredient_groups`, which then
    win), and the method as one text (`instructions`) or as `phases` (ST-1962)."""

    ingredients: str = ""
    # ST-1962: null or [] for one plain list.
    ingredient_groups: list[GroupIn] | None = None
    instructions: str = ""
    # ST-1962: null or [] for a method without phases.
    phases: list[PhaseIn] | None = None

    @field_validator("ingredients", "instructions")
    @classmethod
    def _trim(cls, value: str) -> str:
        return value.strip()

    def groups(self) -> list[structure.Group] | None:
        if self.ingredient_groups is None:
            return None
        return [
            structure.Group(title=group.title, ingredients=group.ingredients)
            for group in self.ingredient_groups
        ]

    def phase_list(self) -> list[structure.Phase] | None:
        if self.phases is None:
            return None
        return [
            structure.Phase(title=phase.title, time=phase.time, instructions=phase.instructions)
            for phase in self.phases
        ]

    def structure_errors(self) -> dict[str, str]:
        return structure.errors(
            ingredients=self.ingredients,
            ingredient_groups=self.groups(),
            phases=self.phase_list(),
        )


def _error(loc: tuple[str | int, ...], message: str, kind: str) -> InitErrorDetails:
    return {"type": PydanticCustomError(kind, message), "loc": loc, "input": None}


def _loc(key: str) -> tuple[str | int, ...]:
    """ "phases.1.instructions" -> ("phases", 1, "instructions")."""
    return tuple(int(part) if part.isdigit() else part for part in key.split("."))


def _structure_errors(recipe: RecipeStructure) -> list[InitErrorDetails]:
    return [
        _error(_loc(key), message, "structure")
        for key, message in recipe.structure_errors().items()
    ]


class RecipeIn(RecipeStructure):
    """Create and edit share one rule set (inventory §3.2). Values are stored trimmed.

    The rules that span fields (food.structure.errors: a plain list or every group needs
    ingredients, several groups need titles, a phase needs a title and a step) are checked
    with the others, so one 422 answers them all: a blank title does not hide a group's."""

    title: str
    # Emneord (ST-784): the whole list, replacing the stored one. Stored as food.tags.normalise
    # leaves it, so "Middag " and "middag" are one tag.
    tags: list[str] = Field(default_factory=list)
    # Porsjoner (ST-1231): how many portions the ingredients make. Optional.
    servings: int | None = None
    # Beskrivelse (ST-1937): optional, a few allowed HTML tags (food.description). Stored as
    # food.description.clean leaves it; at most 500 characters of text, tags not counted.
    description: str = ""

    @model_validator(mode="wrap")
    @classmethod
    def _structure(cls, data: object, handler: ModelWrapValidatorHandler[Self]) -> Self:
        try:
            recipe = handler(data)
        except ValidationError as exc:
            found = [_error(error["loc"], error["msg"], error["type"]) for error in exc.errors()]
            try:
                part = RecipeStructure.model_validate(data)
            except ValidationError:
                pass  # its own type errors are in `found` already
            else:
                found += _structure_errors(part)
            raise ValidationError.from_exception_data(cls.__name__, found) from None
        if found := _structure_errors(recipe):
            raise ValidationError.from_exception_data(cls.__name__, found)
        return recipe

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        return _required(value, "Tittelen må fylles ut.")

    @field_validator("tags")
    @classmethod
    def _tags(cls, value: list[str]) -> list[str]:
        return normalise_tags(value)

    @field_validator("servings")
    @classmethod
    def _servings(cls, value: int | None) -> int | None:
        return _portions(value)

    @field_validator("description")
    @classmethod
    def _description(cls, value: str) -> str:
        value = description.clean(value)
        over = len(description.text(value)) - description.MAX_CHARS
        if over > 0:
            raise PydanticCustomError("too_long", description.too_long(over))
        return value

    def to_recipe(self) -> dict[str, Any]:
        """The recipe to save, as food.services takes it: the flat text and its structure."""
        return {
            "title": self.title,
            "tags": self.tags,
            "servings": self.servings,
            "description": self.description,
            **structure.stored(
                ingredients=self.ingredients,
                instructions=self.instructions,
                ingredient_groups=self.groups(),
                phases=self.phase_list(),
            ),
        }


# Porsjoner, on a recipe and on a day of the week plan: a whole number the form's field allows.
MAX_PORTIONS = 99
PORTIONS_RANGE = "Porsjoner må være et helt tall fra 1 til 99."


def _portions(value: int | None) -> int | None:
    if value is not None and not 1 <= value <= MAX_PORTIONS:
        raise PydanticCustomError("portions", PORTIONS_RANGE)
    return value


class GroupOut(Schema):
    title: str  # "" for the untitled group of a plain list
    ingredients: str  # one per line


class PhaseOut(Schema):
    title: str
    time: str  # "" when not given
    instructions: str  # one paragraph per step


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
    # Porsjoner, or null when the recipe does not say.
    servings: int | None
    # The description as cleaned HTML (only food.description.TAGS), "" when there is none.
    description: str
    # The same as plain text, for the list and the search results.
    description_text: str
    # ST-1962: the ingredients in groups, at least one; a plain list is one untitled group.
    # `ingredients` stays every line of every group, in order.
    ingredient_groups: list[GroupOut]
    # The method's phases, [] when it has none. `instructions` stays the whole method.
    phases: list[PhaseOut]

    class Meta:
        model = Recipe
        fields = ("id", "title", "ingredients", "instructions", "created_at")

    @staticmethod
    def resolve_ingredient_groups(obj: Recipe) -> list[structure.Group]:
        return structure.groups_of(obj)

    @staticmethod
    def resolve_phases(obj: Recipe) -> list[structure.Phase]:
        return structure.phases_of(obj)

    @staticmethod
    def resolve_description_text(obj: Recipe) -> str:
        return description.text(obj.description)

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
    # From a link: the page's own short intro, cleaned like any description. "" otherwise.
    description: str


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


# --- personal keys for assistants (food.keys, ST-833) ---

# The key page's limit, so a long name cannot break the register or the delete page (ST-818 §4).
KEY_NAME_MAX_CHARS = 40


class ApiKeyIn(Schema):
    # Who uses the key, e.g. "Samantha" or "Claude på mobilen". Stored trimmed.
    name: str

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = _required(value, "Gi nøkkelen et navn.")
        if len(value) > KEY_NAME_MAX_CHARS:
            raise PydanticCustomError("too_long", "Navnet kan være høyst 40 tegn.")
        return value


class ApiKeyOut(Schema):
    """A key as the key page lists it. The token is never in here: only its first characters."""

    id: int
    name: str
    prefix: str  # "food_sk_7Qd4"
    created_at: datetime
    last_used_at: datetime | None  # null until an assistant has used it


class ApiKeyCreatedOut(ApiKeyOut):
    """The answer to making a key: the only time the whole token is sent."""

    token: str


# --- the week plan (food.plan, ST-1231) ---


class DinnerIn(Schema):
    """One day's dinner: a recipe or a short text, not both. Replaces what the day had."""

    recipe_id: int | None = None
    # At most 80 characters, e.g. «Rester» or «Ute og spiser».
    text: str | None = None
    # Left out for a recipe: the recipe's own porsjoner (or none: the recipe as written).
    portions: int | None = None


class MoveIn(Schema):
    # The day to move the dinner to. If that day has a dinner, the two swap.
    to: date


class PlanDayOut(Schema):
    """A day of the plan. An empty day has no recipe, an empty title and an empty text."""

    date: date
    weekday: str  # "mandag" … "søndag"
    recipe_id: int | None  # null for a text day, an empty day, or a recipe since deleted
    title: str  # the recipe's title, kept when the recipe is deleted; "" otherwise
    text: str  # the short text of a day without a recipe; "" otherwise
    portions: int | None
    servings: int | None  # the recipe's own porsjoner
    recipe_deleted: bool  # the day had a recipe that has since been deleted
    set_by: str  # who set it (first name, else e-mail); "" for an empty day
    set_at: datetime | None


class PlanWeekOut(Schema):
    """One ISO week, Monday to Sunday."""

    week: str  # "2026-W43", the form /ukeplan?uke= takes
    number: int  # 43
    start: date
    end: date
    previous: str  # "2026-W42"
    next: str  # "2026-W44"
    today: date  # the date in Norway now, so the page marks "I dag" by the server's clock
    days: list[PlanDayOut]
    last_change_by: str  # who set the week's latest dinner; "" in an empty week
    last_change_at: datetime | None


class MoveOut(Schema):
    """The two days after a move: the day it left (now empty, or the swapped dinner) and the day
    it went to."""

    days: list[PlanDayOut]
