from django.http import HttpRequest, HttpResponse
from ninja import NinjaAPI
from ninja.errors import ValidationError

from food.recipes import router as recipes_router

# Every endpoint goes under /api/ (add routers with api.add_router("/api/...")), which the SPA
# fallback never catches. /healthz is a plain view in food.views: its body must be `ok`, not JSON.
api = NinjaAPI(
    title="food.st44.no",
    version="2",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)
api.add_router("/api/recipes", recipes_router)


@api.exception_handler(ValidationError)
def validation_errors(request: HttpRequest, exc: ValidationError) -> HttpResponse:
    """422 as food.schemas.ValidationErrors: {"errors": {"<field>": "<first message>"}}."""
    errors: dict[str, str] = {}
    for error in exc.errors:
        # loc is e.g. ("body", "payload", "title") or ("query", "q"); the field is the last name.
        names = [part for part in error["loc"] if isinstance(part, str)]
        errors.setdefault(names[-1] if names else "", str(error["msg"]))
    return api.create_response(request, {"errors": errors}, status=422)
