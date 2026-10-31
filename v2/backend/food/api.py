from django.http import HttpRequest, HttpResponse
from ninja import NinjaAPI
from ninja.errors import ValidationError

from food.auth import router as auth_router
from food.keys import router as keys_router
from food.oauth import router as oauth_router
from food.plan import router as plan_router
from food.recipes import router as recipes_router
from food.recipes import tags_router

# Every endpoint goes under /api/ (add routers with api.add_router("/api/...")), which the SPA
# fallback never catches. /healthz is a plain view in food.views: its body must be `ok`, not JSON.
api = NinjaAPI(
    title="food.st44.no",
    version="2",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)
api.add_router("/api/auth", auth_router)
api.add_router("/api/recipes", recipes_router)
api.add_router("/api/tags", tags_router)
# Personal keys for the MCP server (ST-833); /api/mcp itself is a plain view (config.urls).
api.add_router("/api/keys", keys_router)
# The Claude app's approval page (ST-834); the OAuth endpoints themselves are food.oauth views.
api.add_router("/api/oauth", oauth_router)
# The week plan (ST-1231): editors only, reads included.
api.add_router("/api/plan", plan_router)


@api.exception_handler(ValidationError)
def validation_errors(request: HttpRequest, exc: ValidationError) -> HttpResponse:
    """422 as food.schemas.ValidationErrors: {"errors": {"<field>": "<first message>"}}."""
    errors: dict[str, str] = {}
    for error in exc.errors:
        loc = tuple(error["loc"])
        if loc[:1] == ("body",) and len(loc) > 2:
            # ("body", "payload", "phases", 1, "instructions"): the path in the body, so a
            # group's or a phase's field (ST-1962) is told from the recipe's own.
            field = ".".join(str(part) for part in loc[2:])
        else:
            # ("query", "q"): the last name.
            names = [part for part in loc if isinstance(part, str)]
            field = names[-1] if names else ""
        errors.setdefault(field, str(error["msg"]))
    return api.create_response(request, {"errors": errors}, status=422)
