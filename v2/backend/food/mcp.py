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
challenge, so the app refreshes it or signs in again. There is no delete tool.
Every write is logged in McpChange. The tools call food.services and food.importer, the same
code the site's API uses.
"""

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

from food import importer, oauth, services
from food.auth import is_editor
from food.keys import KEY_START, editor_for
from food.models import McpChange, Recipe
from food.schemas import LinkImportIn, RecipeIn
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
    "Ingredients are one per line; instructions are paragraphs, one step each."
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
UNREADABLE = "Fant ingen oppskrift på siden. Skriv den inn med create_recipe i stedet."

# The names of the recipe's fields in the change log.
FIELD_NAMES = {
    "title": "tittel",
    "ingredients": "ingredienser",
    "instructions": "fremgangsmåte",
    "tags": "emneord",
}


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
    query: str = Field("", description="Words in the recipe's title, e.g. «kjøttkaker».")
    tag: str = Field("", description="Keep only recipes with this tag (emneord), e.g. «middag».")


class RecipeIdArgs(_Args):
    id: int = Field(description="The recipe's id, from search_recipes.")


class NoArgs(_Args):
    pass


class ImportArgs(_Args):
    url: str = Field(description="The web page with the recipe, e.g. https://www.matprat.no/…")


class CreateArgs(_Args):
    title: str = Field(description="The recipe's name.")
    ingredients: str = Field(description="One ingredient per line, amount first: «2 dl melk».")
    instructions: str = Field("", description="The steps, one paragraph per step.")
    tags: list[str] = Field(
        default_factory=list, description="Tags (emneord), lower case, e.g. [«middag», «fisk»]."
    )


class UpdateArgs(_Args):
    id: int = Field(description="The recipe's id, from search_recipes.")
    title: str | None = Field(None, description="New name. Leave out to keep it.")
    ingredients: str | None = Field(
        None, description="All ingredients, one per line, replacing the list. Leave out to keep."
    )
    instructions: str | None = Field(
        None, description="All the steps, replacing them. Leave out to keep them."
    )
    tags: list[str] | None = Field(
        None,
        description="The whole tag list, replacing it: to add one, send the current tags and "
        "the new one. Leave out to keep the tags.",
    )


# --- what the tools answer


def _link(recipe_id: int) -> str:
    return f"{settings.FOOD_SITE_URL}/recipes/{recipe_id}"


def _summary(recipe: Recipe) -> dict[str, Any]:
    return {
        "id": recipe.id,
        "title": recipe.title,
        "tags": services.tag_names(recipe),
        "link": _link(recipe.id),
    }


def _full(recipe: Recipe) -> dict[str, Any]:
    return {
        **_summary(recipe),
        "ingredients": recipe.ingredients,
        "instructions": recipe.instructions,
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


def _log(writer: Writer, tool: str, recipe_id: int, summary: str) -> None:
    McpChange.objects.create(
        user=writer.user, via=writer.via, tool=tool, recipe_id=recipe_id, summary=summary[:200]
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
        recipe = services.create_recipe(**valid.model_dump())
        _log(writer, "create_recipe", recipe.id, f"ny oppskrift: {recipe.title}")
    return _full(recipe)


def update_recipe(args: UpdateArgs, caller: Caller) -> dict[str, Any]:
    """Changes only the fields given: the rest are read back from the recipe first."""
    writer = caller.editor()
    recipe = _recipe(args.id)
    before = {
        "title": recipe.title,
        "ingredients": recipe.ingredients,
        "instructions": recipe.instructions,
        "tags": services.tag_names(recipe),
    }
    given = args.model_dump(exclude={"id"}, exclude_none=True)
    valid = _validated(**{**before, **given}).model_dump()
    after = {**valid, "tags": sort_names(valid["tags"])}
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
        title=draft.title, ingredients=draft.ingredients, instructions=draft.instructions
    )
    with transaction.atomic():
        recipe = services.create_recipe(**valid.model_dump())
        _log(writer, "import_recipe_from_link", recipe.id, f"hentet fra {url}")
    return _full(recipe)


@dataclass(frozen=True)
class Tool:
    name: str
    title: str
    description: str
    args: type[_Args]
    run: Callable[[Any, Caller], dict[str, Any]]
    writes: bool = False
    open_world: bool = False

    def describe(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "inputSchema": self.args.model_json_schema(),
            "annotations": {
                "title": self.title,
                "readOnlyHint": not self.writes,
                "destructiveHint": False,
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
            "Search the recipes, newest first: by words in the title, by tag, or both. With "
            "neither, every recipe. Answers ids, titles, tags and links.",
            SearchArgs,
            search_recipes,
        ),
        Tool(
            "get_recipe",
            "Les en oppskrift",
            "One whole recipe: title, ingredients (one per line), instructions, tags, link.",
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
    return {"tools": [tool.describe() for tool in TOOLS.values()]}


def _tools_call(params: dict[str, Any], caller: Caller) -> dict[str, Any]:
    name = params.get("name")
    tool = TOOLS.get(name) if isinstance(name, str) else None
    if tool is None:
        raise RpcError(INVALID_PARAMS, f"Unknown tool: {name}")
    arguments = params.get("arguments") or {}
    if not isinstance(arguments, dict):
        raise RpcError(INVALID_PARAMS, "arguments must be an object")
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
