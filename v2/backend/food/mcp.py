"""The MCP server at /api/mcp (ST-833): assistants such as Claude search, read, import, add and
edit recipes from a chat.

MCP's Streamable HTTP transport, stateless: every message is one POST of JSON-RPC, and the
answer is one JSON body. No session is held, nothing is streamed, so GET (the optional SSE
stream) answers 405. This is a small hand-written handler for `initialize`, `ping`,
`tools/list` and `tools/call` rather than the official `mcp` SDK, whose HTTP server is an ASGI
(Starlette + anyio) app and would need a second server process or an async bridge inside this
WSGI app for four methods.

Reads are open to anyone, as on the site. The write tools need `Authorization: Bearer
<token>` of a user on the editor list at the time of the call: either a personal key
(food.keys) or, from the Claude app, an OAuth access token granted `write` (food.oauth, ST-834).
An app token that is expired, revoked or unknown gets HTTP 401 with a WWW-Authenticate
challenge, so the app refreshes it or signs in again. Recipes have no delete tool; meals
(ST-1968) have one, as the plan asks: a meal is a short list, quickly written again. The week
plan's tools (ST-1231) need an editor even to read, and are not listed for anyone else. Every
write is logged in McpChange. The tools call food.services, food.meals and food.importer, the
same code the site's API uses.
"""

import datetime as dt
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from django.conf import settings
from django.contrib.auth.models import User
from django.db import transaction
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from food import importer, meals, oauth, plan, services, structure
from food.auth import is_editor
from food.keys import KEY_START, editor_for
from food.models import McpChange, Meal, Recipe
from food.schemas import LinkImportIn, MealIn, RecipeIn
from food.tags import sort_names

logger = logging.getLogger(__name__)

# Newest first. An `initialize` asking for another version gets the newest (the spec's rule).
PROTOCOL_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26")

SERVER_INFO = {
    "name": "food.st44.no",
    "title": "food.st44.no — familiens oppskrifter",
    "version": "2",
}
INSTRUCTIONS = (
    "The household's recipe collection at food.st44.no, in Norwegian. Search and read freely. "
    "Adding, importing and editing need an editor: an editor's key, or the Claude app signed "
    "in with an editor's Google account. Recipes cannot be deleted from here. "
    "Ingredients are one per line; instructions are paragraphs, one step each. A recipe may "
    "split its ingredients into titled groups (ingredient_groups: «Rub», «Glaze») and its "
    "method into phases with a title and an optional time (phases: «Røyk», «3 timer på "
    "110-120 °C»); steps are numbered through the whole recipe. `ingredients` is always "
    "every line of every group, in order: use it for a shopping list. "
    "Meals (måltider) are not recipes: a meal is a shopping list for a dinner without a "
    "recipe, e.g. «Toro Tandoori chicken»: a title, items one per line in the same format as "
    "ingredients («2 pk naan»), and a short note. No steps, no portions. Read them with "
    "list_meals and get_meal; editors change them with save_meal and delete_meal. "
    "Editors also have the household's week plan (ukeplan): one dinner a day, a recipe, a meal "
    "or a short text, read with get_meal_plan and changed with set_dinner and clear_dinner. "
    "get_meal_plan gives every recipe and meal day its shopping lines in `ingredients`."
)

# JSON-RPC 2.0 error codes.
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603

NO_KEY = (
    "Å legge inn eller endre oppskrifter krever en nøkkel fra en redaktør, sendt som "
    "«Authorization: Bearer <nøkkel>». Nøkler lages på https://food.st44.no/assistent/nokler. "
    "Søk og lesing går uten nøkkel."
)
APP_NOT_AN_EDITOR = (
    "Kontoen du logget inn med i Claude-appen, er ikke redaktør. Claude kan søke og lese, men "
    "ikke legge inn eller endre oppskrifter."
)
APP_READ_ONLY = (
    "Claude fikk bare lesetilgang da du koblet til. Fjern food.st44.no i Claude-appen og koble "
    "til på nytt for å kunne legge inn og endre oppskrifter."
)
NOT_FOUND = "Fant ingen oppskrift med id {id}."
MEAL_NOT_FOUND = "Fant ikke noe måltid med id {id}."
MEAL_NEEDS = "Et nytt måltid trenger title og items."
NO_PLAN = (
    "Ukeplanen er privat for husstanden: den krever en nøkkel fra en redaktør, eller Claude-appen "
    "logget inn med en redaktørs Google-konto. Nøkler lages på "
    "https://food.st44.no/assistent/nokler."
)
UNREADABLE = "Fant ingen oppskrift på siden. Skriv den inn med create_recipe i stedet."

# The names of the recipe's fields in the change log.
FIELD_NAMES = {
    "title": "tittel",
    "ingredients": "ingredienser",
    "instructions": "fremgangsmåte",
    "tags": "emneord",
    "servings": "porsjoner",
    "description": "beskrivelse",
}
SERVINGS = "How many portions the ingredients make (1 to 99). The week plan defaults to it."
# The names of a meal's fields in the change log.
MEAL_FIELD_NAMES = {"title": "tittel", "items": "varer", "note": "notat"}
DESCRIPTION = (
    "A short intro to the recipe, shown under its title: one to three sentences, at most 500 "
    "characters of text (tags not counted). May use <b>, <strong>, <i>, <em>, <u>, <br>, <p>, "
    '<ul>, <ol>, <li> and <a href="https://…">; other tags and attributes are removed.'
)


class ToolError(Exception):
    """A tool call that failed in a way the assistant should read and can act on: the result
    has `isError: true` and this message, not a JSON-RPC error."""


@dataclass(frozen=True)
class Writer:
    """An editor writing: who, and through what (the key's name, or "Claude app")."""

    user: User
    via: str


@dataclass(frozen=True)
class Caller:
    """Who is calling: the editor behind the Authorization header, and else why writes are
    refused."""

    writer: Writer | None
    refusal: str

    def editor(self) -> Writer:
        if self.writer is None:
            raise ToolError(self.refusal)
        return self.writer


def _caller(request: HttpRequest) -> Caller | None:
    """None for an app token that is not valid (any more): the endpoint answers 401."""
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        return Caller(None, NO_KEY)
    if token.startswith(KEY_START):
        key, why = editor_for(token)
        return Caller(Writer(key.user, key.name) if key else None, why)
    access = oauth.access_for(token)
    if access is None:
        return None
    if not is_editor(access.user):
        return Caller(None, APP_NOT_AN_EDITOR)
    if not access.can_write:
        return Caller(None, APP_READ_ONLY)
    return Caller(Writer(access.user, oauth.VIA), "")


# --- the tools' arguments: validated by pydantic, and their JSON Schema is what tools/list sends


class _Args(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SearchArgs(_Args):
    query: str = Field(
        "", description="Words in the recipe's title or description, e.g. «kjøttkaker»."
    )
    tag: str = Field("", description="Keep only recipes with this tag (emneord), e.g. «middag».")


class RecipeIdArgs(_Args):
    id: int = Field(description="The recipe's id, from search_recipes.")


class NoArgs(_Args):
    pass


class ImportArgs(_Args):
    url: str = Field(description="The web page with the recipe, e.g. https://www.matprat.no/…")


class GroupArg(_Args):
    title: str = Field(
        "", description="The group's title, e.g. «Glaze». Needed when there are several."
    )
    ingredients: str = Field(description="One ingredient per line, amount first.")


class PhaseArg(_Args):
    title: str = Field(description="The phase's title, e.g. «Røyk».")
    time: str = Field("", description="Optional: how long, e.g. «3 timer på 110-120 °C».")
    instructions: str = Field(description="The phase's steps, one paragraph per step.")


GROUPS = (
    "The ingredients in titled groups, in order, e.g. [{title: «Rub», ingredients: …}, "
    "{title: «Glaze», …}]. Instead of ingredients; with several groups each needs a title."
)
PHASES = (
    "The method in phases, in order, each with a title, an optional time and its steps. "
    "Instead of instructions. Steps are numbered through the whole recipe."
)


class CreateArgs(_Args):
    title: str = Field(description="The recipe's name.")
    ingredients: str = Field(
        "",
        description="One ingredient per line, amount first: «2 dl melk». Or give "
        "ingredient_groups.",
    )
    ingredient_groups: list[GroupArg] | None = Field(None, description=GROUPS)
    instructions: str = Field("", description="The steps, one paragraph per step.")
    phases: list[PhaseArg] | None = Field(None, description=PHASES)
    tags: list[str] = Field(
        default_factory=list, description="Tags (emneord), lower case, e.g. [«middag», «fisk»]."
    )
    servings: int | None = Field(None, description=SERVINGS + " Leave out if unknown.")
    description: str = Field("", description=DESCRIPTION)


class UpdateArgs(_Args):
    id: int = Field(description="The recipe's id, from search_recipes.")
    title: str | None = Field(None, description="New name. Leave out to keep it.")
    ingredients: str | None = Field(
        None,
        description="All ingredients, one per line, replacing the list and any groups with "
        "one plain list. Leave out to keep.",
    )
    ingredient_groups: list[GroupArg] | None = Field(
        None, description=GROUPS + " Replaces all the ingredients. Leave out to keep."
    )
    instructions: str | None = Field(
        None,
        description="All the steps, replacing them and any phases. Leave out to keep them.",
    )
    phases: list[PhaseArg] | None = Field(
        None, description=PHASES + " Replaces the whole method. Leave out to keep it."
    )
    tags: list[str] | None = Field(
        None,
        description="The whole tag list, replacing it: to add one, send the current tags and "
        "the new one. Leave out to keep the tags.",
    )
    servings: int | None = Field(
        None, description=SERVINGS + " Leave out to keep it; 0 removes it."
    )
    description: str | None = Field(
        None, description=DESCRIPTION + ' Leave out to keep it; "" removes it.'
    )


class MealIdArgs(_Args):
    id: int = Field(description="The meal's id, from list_meals.")


class SaveMealArgs(_Args):
    id: int | None = Field(
        None, description="The meal to change, from list_meals. Leave out to add a new meal."
    )
    title: str | None = Field(
        None, description="The meal's name, e.g. «Toro Tandoori chicken». Needed for a new one."
    )
    items: str | None = Field(
        None,
        description="What to buy, one item per line, amount first when there is one: "
        "«2 pk naan», «mango chutney». The whole list, replacing it. Needed for a new one.",
    )
    note: str | None = Field(
        None,
        description="A short note (at most 300 characters), e.g. how long it is in the oven. "
        '"" removes it.',
    )


class MealPlanArgs(_Args):
    start: dt.date | None = Field(
        None, description="The first day, YYYY-MM-DD. Leave out for this week's Monday."
    )
    days: int = Field(7, ge=1, le=31, description="How many days from start (1 to 31).")


class SetDinnerArgs(_Args):
    date: dt.date = Field(description="The day, YYYY-MM-DD.")
    recipe_id: int | None = Field(
        None,
        description="The recipe's id, from search_recipes. Give one of recipe_id, meal_id and "
        "text.",
    )
    meal_id: int | None = Field(
        None, description="A meal's id, from list_meals, instead of a recipe. No portions."
    )
    text: str | None = Field(
        None, description="A short text instead of a recipe (at most 80 characters): «Rester»."
    )
    portions: int | None = Field(
        None,
        description="Portions for a recipe (1 to 99). Leave out to use the recipe's own "
        "(servings). Not for a meal.",
    )


class DayArgs(_Args):
    date: dt.date = Field(description="The day, YYYY-MM-DD.")


# --- what the tools answer


def _link(recipe_id: int) -> str:
    return f"{settings.FOOD_SITE_URL}/recipes/{recipe_id}"


def _meal_link(meal_id: int) -> str:
    return f"{settings.FOOD_SITE_URL}/maltider/{meal_id}"


def _summary(recipe: Recipe) -> dict[str, Any]:
    return {
        "id": recipe.id,
        "title": recipe.title,
        "description": recipe.description,
        "tags": services.tag_names(recipe),
        "link": _link(recipe.id),
    }


def _full(recipe: Recipe) -> dict[str, Any]:
    return {
        **_summary(recipe),
        "ingredients": recipe.ingredients,
        "ingredient_groups": structure.groups_of(recipe),
        "instructions": recipe.instructions,
        "phases": structure.phases_of(recipe),
        "servings": recipe.servings,
        "created_at": recipe.created_at.isoformat(),
    }


def _recipe(recipe_id: int) -> Recipe:
    recipe = Recipe.objects.prefetch_related("tags").filter(pk=recipe_id).first()
    if recipe is None:
        raise ToolError(NOT_FOUND.format(id=recipe_id))
    return recipe


def _validated(**fields: object) -> RecipeIn:
    """The site's own rules for a recipe (food.schemas.RecipeIn), with its Norwegian messages."""
    try:
        return RecipeIn.model_validate(fields)
    except ValidationError as exc:
        raise ToolError(_messages(exc)) from exc


def _messages(exc: ValidationError) -> str:
    return " ".join(
        f"{'.'.join(str(part) for part in error['loc']) or 'arguments'}: {error['msg']}"
        for error in exc.errors()
    )


def _log(
    writer: Writer, tool: str, recipe_id: int | None, summary: str, meal_id: int | None = None
) -> None:
    McpChange.objects.create(
        user=writer.user,
        via=writer.via,
        tool=tool,
        recipe_id=recipe_id,
        meal_id=meal_id,
        summary=summary[:200],
    )


# --- the tools


def search_recipes(args: SearchArgs, caller: Caller) -> dict[str, Any]:
    recipes = services.search_recipes(args.query, args.tag)
    return {"count": len(recipes), "recipes": [_summary(recipe) for recipe in recipes]}


def get_recipe(args: RecipeIdArgs, caller: Caller) -> dict[str, Any]:
    return _full(_recipe(args.id))


def list_tags(args: NoArgs, caller: Caller) -> dict[str, Any]:
    return {"tags": services.tags_in_use()}


def create_recipe(args: CreateArgs, caller: Caller) -> dict[str, Any]:
    writer = caller.editor()
    valid = _validated(**args.model_dump())
    with transaction.atomic():
        recipe = services.create_recipe(**valid.to_recipe())
        _log(writer, "create_recipe", recipe.id, f"ny oppskrift: {recipe.title}")
    return _full(recipe)


def _compared(fields: dict[str, Any]) -> dict[str, Any]:
    """The fields as the change log names them: a regrouping changes "ingredienser"."""
    return {
        **fields,
        "ingredients": (fields["ingredients"], fields["ingredient_groups"]),
        "instructions": (fields["instructions"], fields["phases"]),
    }


def update_recipe(args: UpdateArgs, caller: Caller) -> dict[str, Any]:
    """Changes only the fields given: the rest are read back from the recipe first. A plain
    `ingredients` or `instructions` replaces the groups or the phases as well."""
    writer = caller.editor()
    recipe = _recipe(args.id)
    current: dict[str, Any] = {
        "title": recipe.title,
        "ingredients": recipe.ingredients,
        "ingredient_groups": structure.groups_of(recipe),
        "instructions": recipe.instructions,
        "phases": structure.phases_of(recipe),
        "tags": services.tag_names(recipe),
        "servings": recipe.servings,
        "description": recipe.description,
    }
    before = _compared(current)
    given = args.model_dump(exclude={"id"}, exclude_none=True)
    if given.get("servings") == 0:
        given["servings"] = None
    if "ingredients" in given:
        current["ingredient_groups"] = None
    if "instructions" in given:
        current["phases"] = None
    valid = _validated(**{**current, **given}).to_recipe()
    after = _compared({**valid, "tags": sort_names(valid["tags"])})
    changed = [name for name in FIELD_NAMES if after[name] != before[name]]
    if changed:
        summary = "endret: " + ", ".join(FIELD_NAMES[name] for name in changed)
        with transaction.atomic():
            recipe = services.update_recipe(recipe, **valid)
            _log(writer, "update_recipe", recipe.id, summary)
    return {**_full(_recipe(recipe.id)), "changed": changed}


def import_recipe_from_link(args: ImportArgs, caller: Caller) -> dict[str, Any]:
    writer = caller.editor()
    try:
        url = LinkImportIn(url=args.url).url
        draft = importer.import_link(url)
    except ValidationError as exc:
        raise ToolError(importer.BAD_URL) from exc
    except (importer.NotAllowed, importer.FetchError) as exc:
        raise ToolError(str(exc)) from exc
    if not draft.readable:
        raise ToolError(UNREADABLE)
    valid = _validated(
        title=draft.title,
        ingredients=draft.ingredients,
        instructions=draft.instructions,
        description=draft.description,
    )
    with transaction.atomic():
        recipe = services.create_recipe(**valid.to_recipe())
        _log(writer, "import_recipe_from_link", recipe.id, f"hentet fra {url}")
    return _full(recipe)


# --- meals (food.meals, ST-1968): read by anyone, changed by an editor


def _meal(meal_id: int) -> Meal:
    meal = Meal.objects.filter(pk=meal_id).first()
    if meal is None:
        raise ToolError(MEAL_NOT_FOUND.format(id=meal_id))
    return meal


def _meal_summary(meal: Meal) -> dict[str, Any]:
    return {
        "id": meal.id,
        "title": meal.title,
        "item_count": meals.item_count(meal),
        "link": _meal_link(meal.id),
    }


def _meal_full(meal: Meal) -> dict[str, Any]:
    return {
        **_meal_summary(meal),
        "items": meal.items,
        "note": meal.note,
        "created_at": meal.created_at.isoformat(),
    }


def _valid_meal(**fields: object) -> MealIn:
    try:
        return MealIn.model_validate(fields)
    except ValidationError as exc:
        raise ToolError(_messages(exc)) from exc


def list_meals(args: NoArgs, caller: Caller) -> dict[str, Any]:
    found = list(Meal.objects.all())
    return {"count": len(found), "meals": [_meal_summary(meal) for meal in found]}


def get_meal(args: MealIdArgs, caller: Caller) -> dict[str, Any]:
    return _meal_full(_meal(args.id))


def save_meal(args: SaveMealArgs, caller: Caller) -> dict[str, Any]:
    """Without an id, a new meal; with one, only the fields given change."""
    writer = caller.editor()
    given = args.model_dump(exclude={"id"}, exclude_none=True)
    if args.id is None:
        if "title" not in given or "items" not in given:
            raise ToolError(MEAL_NEEDS)
        valid = _valid_meal(**given)
        with transaction.atomic():
            meal = meals.create_meal(**valid.model_dump())
            _log(writer, "save_meal", None, f"nytt måltid: {meal.title}", meal.id)
        return _meal_full(meal)
    meal = _meal(args.id)
    current = {"title": meal.title, "items": meal.items, "note": meal.note}
    valid_fields = _valid_meal(**{**current, **given}).model_dump()
    changed = [name for name in MEAL_FIELD_NAMES if valid_fields[name] != current[name]]
    if changed:
        summary = "endret: " + ", ".join(MEAL_FIELD_NAMES[name] for name in changed)
        with transaction.atomic():
            meal = meals.update_meal(meal, **valid_fields)
            _log(writer, "save_meal", None, summary, meal.id)
    return {**_meal_full(meal), "changed": changed}


def delete_meal(args: MealIdArgs, caller: Caller) -> dict[str, Any]:
    writer = caller.editor()
    meal = _meal(args.id)
    days = [day.isoformat() for day in meals.planned_days(meal, dt.date.min)]
    with transaction.atomic():
        meals.delete_meal(meal)
        _log(writer, "delete_meal", None, f"slettet måltid: {meal.title}", args.id)
    return {"deleted": True, "id": args.id, "title": meal.title, "planned_days_kept": days}


# --- the week plan (food.plan, ST-1231): editors only, reads included


def _plan_day(day: dict[str, Any], lines: dict[tuple[str, int], str]) -> dict[str, Any]:
    recipe_id, meal_id = day["recipe_id"], day["meal_id"]
    if recipe_id:
        link, ingredients = _link(recipe_id), lines.get(("recipe", recipe_id), "")
    elif meal_id:
        link, ingredients = _meal_link(meal_id), lines.get(("meal", meal_id), "")
    else:
        link, ingredients = None, ""
    return {
        "date": day["date"].isoformat(),
        "weekday": day["weekday"],
        "kind": day["kind"],
        "recipe_id": recipe_id,
        "meal_id": meal_id,
        "title": day["title"],
        "text": day["text"],
        "portions": day["portions"],
        "servings": day["servings"],
        "ingredients": ingredients,
        "recipe_deleted": day["recipe_deleted"],
        "meal_deleted": day["meal_deleted"],
        "link": link,
    }


def _shopping_lines(days: list[dict[str, Any]]) -> dict[tuple[str, int], str]:
    """The ingredients of the days' recipes and the items of their meals, by kind and id."""
    recipe_ids = {day["recipe_id"] for day in days if day["recipe_id"]}
    meal_ids = {day["meal_id"] for day in days if day["meal_id"]}
    lines: dict[tuple[str, int], str] = {}
    for recipe_id, ingredients in Recipe.objects.filter(pk__in=recipe_ids).values_list(
        "id", "ingredients"
    ):
        lines["recipe", recipe_id] = "\n".join(plan.item_lines(ingredients))
    for meal_id, items in Meal.objects.filter(pk__in=meal_ids).values_list("id", "items"):
        lines["meal", meal_id] = "\n".join(plan.item_lines(items))
    return lines


def _one_day(day: dict[str, Any]) -> dict[str, Any]:
    return _plan_day(day, _shopping_lines([day]))


def get_meal_plan(args: MealPlanArgs, caller: Caller) -> dict[str, Any]:
    caller.editor()
    start = args.start or plan.monday_of(plan.today())
    days = plan.read_days(start, args.days)
    lines = _shopping_lines(days)
    return {
        "start": start.isoformat(),
        "end": days[-1]["date"].isoformat(),
        "days": [_plan_day(day, lines) for day in days],
        "link": f"{settings.FOOD_SITE_URL}/ukeplan?uke={plan.week_name(plan.monday_of(start))}",
    }


def _what(day: dict[str, Any]) -> str:
    what: str = day["title"] or day["text"]
    if day["kind"] == "meal":
        what += " (måltid)"
    if day["portions"]:
        what += f" ({day['portions']} porsjoner)"
    return what


def set_dinner(args: SetDinnerArgs, caller: Caller) -> dict[str, Any]:
    writer = caller.editor()
    try:
        dinner = plan.check(
            recipe_id=args.recipe_id, meal_id=args.meal_id, text=args.text, portions=args.portions
        )
    except plan.PlanError as exc:
        raise ToolError(f"{exc.field}: {exc.message}") from exc
    with transaction.atomic():
        day = plan.set_dinner(args.date, dinner, writer.user)
        summary = f"{args.date.isoformat()}: {_what(day)}"
        _log(writer, "set_dinner", day["recipe_id"], summary, day["meal_id"])
    return _one_day(day)


def clear_dinner(args: DayArgs, caller: Caller) -> dict[str, Any]:
    writer = caller.editor()
    before = plan.get_day(args.date)
    with transaction.atomic():
        cleared = plan.clear_dinner(args.date)
        if cleared:
            summary = f"{args.date.isoformat()}: fjernet {before['title'] or before['text']}"
            _log(writer, "clear_dinner", before["recipe_id"], summary, before["meal_id"])
    return {**_one_day(plan.get_day(args.date)), "cleared": cleared}


@dataclass(frozen=True)
class Tool:
    name: str
    title: str
    description: str
    args: type[_Args]
    run: Callable[[Any, Caller], dict[str, Any]]
    writes: bool = False
    open_world: bool = False
    destructive: bool = False
    # Listed and run only for an editor: the week plan is private (ST-1231).
    editors_only: bool = False

    def describe(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "inputSchema": self.args.model_json_schema(),
            "annotations": {
                "title": self.title,
                "readOnlyHint": not self.writes,
                "destructiveHint": self.destructive,
                "idempotentHint": not self.writes,
                "openWorldHint": self.open_world,
            },
        }


WRITE_NOTE = " Needs an editor. Answers with the recipe and its link on food.st44.no."

TOOLS = {
    tool.name: tool
    for tool in (
        Tool(
            "search_recipes",
            "Søk i oppskriftene",
            "Search the recipes, newest first: by words in the title or description, by tag, or "
            "both. With neither, every recipe. Answers ids, titles, descriptions, tags and "
            "links.",
            SearchArgs,
            search_recipes,
        ),
        Tool(
            "get_recipe",
            "Les en oppskrift",
            "One whole recipe: title, description (a little HTML), ingredients (one per line, "
            "every group), ingredient_groups, instructions, phases, servings, tags, link.",
            RecipeIdArgs,
            get_recipe,
        ),
        Tool(
            "list_tags",
            "Emneordene",
            "Every tag (emneord) in use, with how many recipes carry it, in Norwegian order.",
            NoArgs,
            list_tags,
        ),
        Tool(
            "import_recipe_from_link",
            "Hent oppskrift fra lenke",
            "Read the recipe on a web page and save it as a new recipe, as «Ny oppskrift → Fra "
            "lenke» does on the site." + WRITE_NOTE,
            ImportArgs,
            import_recipe_from_link,
            writes=True,
            open_world=True,
        ),
        Tool(
            "create_recipe",
            "Legg inn en oppskrift",
            "Save a new recipe." + WRITE_NOTE,
            CreateArgs,
            create_recipe,
            writes=True,
        ),
        Tool(
            "update_recipe",
            "Endre en oppskrift",
            "Change a recipe. Only the fields you send change; leave out the rest. Tags are "
            "replaced as a whole list." + WRITE_NOTE,
            UpdateArgs,
            update_recipe,
            writes=True,
        ),
        Tool(
            "list_meals",
            "Måltidene",
            "Every meal, by title: id, title, how many items, link. A meal is a shopping list "
            "for a dinner without a recipe, not a recipe.",
            NoArgs,
            list_meals,
        ),
        Tool(
            "get_meal",
            "Les et måltid",
            "One meal: title, items (one per line, amount first, the same format as a recipe's "
            "ingredients), note, link. A meal has no steps and no portions.",
            MealIdArgs,
            get_meal,
        ),
        Tool(
            "save_meal",
            "Lagre et måltid",
            "Add a meal (no id: title and items needed) or change one (id: only the fields you "
            "send change; items are replaced as a whole list). A meal is a shopping list, not a "
            "recipe. Needs an editor. Answers with the meal and its link on food.st44.no.",
            SaveMealArgs,
            save_meal,
            writes=True,
        ),
        Tool(
            "delete_meal",
            "Slett et måltid",
            "Delete a meal for good. Days in the week plan that had it keep its name, without "
            "the link. Needs an editor.",
            MealIdArgs,
            delete_meal,
            writes=True,
            destructive=True,
        ),
        Tool(
            "get_meal_plan",
            "Les ukeplanen",
            "The household's dinner plan: each day with date, weekday, kind (recipe, meal, text, "
            "or null for an empty day), the recipe or meal (id, title, link) or a short text, "
            "portions, the recipe's servings, and `ingredients`: the day's shopping lines, one "
            "per line, a recipe's ingredients or a meal's items in the same format. Defaults to "
            "this week, Monday to Sunday. Needs an editor.",
            MealPlanArgs,
            get_meal_plan,
            editors_only=True,
        ),
        Tool(
            "set_dinner",
            "Sett middag",
            "Put a dinner on a day of the week plan: a recipe (recipe_id, from search_recipes), "
            "a meal (meal_id, from list_meals) or a short text, replacing what the day had. "
            "Portions default to the recipe's servings; a meal has none. Needs an editor.",
            SetDinnerArgs,
            set_dinner,
            writes=True,
            editors_only=True,
        ),
        Tool(
            "clear_dinner",
            "Fjern middag",
            "Empty a day of the week plan. The recipe or meal itself stays. Needs an editor.",
            DayArgs,
            clear_dinner,
            writes=True,
            editors_only=True,
        ),
    )
}


# --- JSON-RPC


class RpcError(Exception):
    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _initialize(params: dict[str, Any], caller: Caller) -> dict[str, Any]:
    asked = params.get("protocolVersion")
    version = asked if asked in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0]
    return {
        "protocolVersion": version,
        "capabilities": {"tools": {"listChanged": False}},
        "serverInfo": SERVER_INFO,
        "instructions": INSTRUCTIONS,
    }


def _tools_list(params: dict[str, Any], caller: Caller) -> dict[str, Any]:
    tools = list(TOOLS.values())
    if caller.writer is None:
        tools = [tool for tool in tools if not tool.editors_only]
    return {"tools": [tool.describe() for tool in tools]}


def _tools_call(params: dict[str, Any], caller: Caller) -> dict[str, Any]:
    name = params.get("name")
    tool = TOOLS.get(name) if isinstance(name, str) else None
    if tool is None:
        raise RpcError(INVALID_PARAMS, f"Unknown tool: {name}")
    arguments = params.get("arguments") or {}
    if not isinstance(arguments, dict):
        raise RpcError(INVALID_PARAMS, "arguments must be an object")
    if tool.editors_only and caller.writer is None:
        # Not listed for this caller, but named: say why rather than "unknown tool".
        return _tool_error(NO_PLAN if caller.refusal == NO_KEY else caller.refusal)
    try:
        result = tool.run(tool.args.model_validate(arguments), caller)
    except ValidationError as exc:
        return _tool_error(_messages(exc))
    except ToolError as exc:
        return _tool_error(str(exc))
    return {
        "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}],
        "structuredContent": result,
        "isError": False,
    }


def _tool_error(message: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": message}], "isError": True}


METHODS: dict[str, Callable[[dict[str, Any], Caller], dict[str, Any]]] = {
    "initialize": _initialize,
    "ping": lambda params, caller: {},
    "tools/list": _tools_list,
    "tools/call": _tools_call,
}


def _answer(message: object, caller: Caller) -> dict[str, Any] | None:
    """The response to one JSON-RPC message, or None for a notification or a response."""
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        return _error(None, INVALID_REQUEST, "Not a JSON-RPC 2.0 message")
    if "method" not in message or "id" not in message:
        return None  # a notification (e.g. notifications/initialized) or a client's response
    message_id = message["id"]
    method, params = message["method"], message.get("params") or {}
    handler = METHODS.get(method) if isinstance(method, str) else None
    if handler is None:
        return _error(message_id, METHOD_NOT_FOUND, f"Method not found: {method}")
    if not isinstance(params, dict):
        return _error(message_id, INVALID_PARAMS, "params must be an object")
    try:
        return {"jsonrpc": "2.0", "id": message_id, "result": handler(params, caller)}
    except RpcError as exc:
        return _error(message_id, exc.code, exc.message)
    except Exception:
        logger.exception("MCP %s failed", method)
        return _error(message_id, INTERNAL_ERROR, "Noe gikk galt på food.st44.no. Prøv igjen.")


def _error(message_id: object, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": message_id, "error": {"code": code, "message": message}}


def _origin_allowed(request: HttpRequest) -> bool:
    """The spec's guard against DNS rebinding: a browser page may only call from this site.
    Assistants' servers and desktop apps send no Origin."""
    origin = request.headers.get("Origin")
    return origin is None or origin in settings.CSRF_TRUSTED_ORIGINS


# Bearer tokens, not cookies: there is no session for a cross-site request to ride on.
@csrf_exempt
def endpoint(request: HttpRequest) -> HttpResponse:
    if request.method != "POST":
        response = HttpResponse(status=405)
        response["Allow"] = "POST"
        return response
    if not _origin_allowed(request):
        return JsonResponse(_error(None, INVALID_REQUEST, "Origin not allowed"), status=403)
    version = request.headers.get("MCP-Protocol-Version")
    if version is not None and version not in PROTOCOL_VERSIONS:
        message = f"Unsupported MCP-Protocol-Version: {version}"
        return JsonResponse(_error(None, INVALID_REQUEST, message), status=400)
    try:
        message = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        return JsonResponse(_error(None, PARSE_ERROR, "Parse error"), status=400)
    if isinstance(message, list):
        # Batches were dropped from the protocol in 2025-06-18.
        return JsonResponse(_error(None, INVALID_REQUEST, "Batches are not supported"))
    caller = _caller(request)
    if caller is None:
        refused = JsonResponse(_error(None, INVALID_REQUEST, "Invalid access token"), status=401)
        refused["WWW-Authenticate"] = oauth.challenge(request)
        return refused
    answer = _answer(message, caller)
    if answer is None:
        return HttpResponse(status=202)
    return JsonResponse(answer, json_dumps_params={"ensure_ascii": False})
