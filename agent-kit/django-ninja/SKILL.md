---
name: django-ninja
description: Write and change the Django + Django Ninja JSON API for food.st44.no — routers per app, Pydantic Schema/ModelSchema in and out, error responses, session auth with CSRF, pagination, TestClient + pytest-django tests, OpenAPI export for the Angular types, and mypy --strict typing. Use for any Python backend work in this repo.
---

# Django Ninja for food.st44.no

Targets **Django Ninja 1.7.x** (1.7.1 at time of writing) on **Django 6.x**,
Pydantic 2. Source: https://django-ninja.dev/ and the project's ADR 0002.
If `uv.lock` pins another Ninja version, trust the lock and check its docs.

Ninja is **not** DRF. No serializers, viewsets, `APIView`, `Response`,
`permission_classes` or `request.data`. If you are about to write one of
those, stop and use the patterns below.

## Layout: one Router per app, one NinjaAPI per project

```
<project>/api.py          # the single NinjaAPI; mounts every app router
<app>/api.py              # router = Router(tags=["recipes"]); thin views only
<app>/schemas.py          # Schema / ModelSchema classes, In and Out
<app>/services.py         # business logic + ORM writes; plain typed functions
<app>/tests/test_api.py   # TestClient + pytest-django
```

```python
# <project>/api.py
from ninja import NinjaAPI
from recipes.api import router as recipes_router

api = NinjaAPI(title="food.st44.no", version="2")
api.add_router("/recipes", recipes_router)
# urls.py: path("api/", api.urls)
```

- Exactly one `NinjaAPI` instance. Apps never create their own.
- Set `tags` on each Router; the OpenAPI client groups by tag.
- Views parse input, call a service, return a schema-shaped object. Nothing
  else. Queries more complex than one `get`/`filter` live in `services.py`.

## Schemas: explicit In and Out per endpoint

```python
from ninja import ModelSchema, Schema
from recipes.models import Recipe

class RecipeOut(ModelSchema):
    class Meta:
        model = Recipe
        fields = ["id", "title", "servings", "created_at"]

class RecipeIn(ModelSchema):
    class Meta:
        model = Recipe
        fields = ["title", "servings"]

class RecipePatch(ModelSchema):
    class Meta:
        model = Recipe
        fields = ["title", "servings"]
        fields_optional = "__all__"

class ErrorOut(Schema):
    detail: str
```

- Always list `fields` explicitly. Never `fields = "__all__"` or `exclude` —
  a new model column must not silently appear in (or be writable through)
  the API.
- Separate `XIn` and `XOut`. Never accept an `id`, `created_at`, owner or
  role from the client.
- Use `Meta`, not pydantic `Config` / `model_config` on `ModelSchema`.
- Plain `Schema` for anything not 1:1 with a model (nested payloads,
  computed fields). Add validation with pydantic `Field(...)` /
  `field_validator`, not by hand in the view.

## Views: typed, with every response code declared

```python
from django.http import HttpRequest
from django.shortcuts import get_object_or_404
from ninja import Router, Status
from ninja.security import django_auth

from recipes import services
from recipes.models import Recipe
from recipes.schemas import ErrorOut, RecipeIn, RecipeOut

router = Router(tags=["recipes"])

@router.get("/{recipe_id}", response={200: RecipeOut, 404: ErrorOut})
def get_recipe(request: HttpRequest, recipe_id: int) -> Recipe:
    return get_object_or_404(Recipe, pk=recipe_id)

@router.post("/", response={201: RecipeOut, 403: ErrorOut}, auth=django_auth)
def create_recipe(request: HttpRequest, payload: RecipeIn) -> Status[Recipe]:
    editor = services.require_editor(request)
    recipe = services.create_recipe(author=editor, **payload.model_dump())
    return Status(201, recipe)
```

- Every view: `request: HttpRequest`, typed params, a typed `payload: XIn`,
  and a return annotation. Return a model instance, a schema or a QuerySet —
  Ninja validates it against `response`.
- Declare every status the endpoint can return in `response=` so the
  generated TypeScript knows the error shapes.
- Status rules: with **one** code in `response`, a plain return uses it
  (`response={201: X}` → 201). With **several** codes, a plain return means
  200 — if 200 is not declared it raises `ConfigError`. So return
  `Status(201, obj)` / `Status(204, None)`. Returning a `(code, body)` tuple
  is **deprecated** in 1.7 — do not.
- Errors: `raise HttpError(403, "Not an editor")` (body
  `{"detail": "..."}`) or `get_object_or_404` (404 `{"detail": "Not Found"}`).
  Request validation errors are 422 with `detail` as a **list** — don't
  declare 422 with `ErrorOut`, and don't re-validate in the view. Domain
  exceptions from services map to HTTP in one place with
  `@api.exception_handler(MyError)` in `<project>/api.py`.
- Give each operation a stable name: the function name becomes the
  `operationId` and therefore the TypeScript method name. Don't rename views
  casually.

## Auth: Django session + CSRF

- Use `auth=django_auth` (or `SessionAuth()`, `SessionAuthIsStaff()`) on a
  Router or operation. Read-only public endpoints may have no auth.
- With cookie/session auth, Ninja **turns CSRF checking on automatically**
  for that operation. Endpoints with no auth get **no** CSRF check — so every
  POST/PUT/PATCH/DELETE must have session auth. Never use `csrf_exempt` on a
  mutating endpoint.
- The SPA gets the `csrftoken` cookie from one GET endpoint, and Angular
  sends it back with
  `withXsrfConfiguration({cookieName: "csrftoken", headerName: "X-CSRFToken"})`:

  ```python
  @api.get("/csrf")
  @ensure_csrf_cookie          # below the route decorator
  def csrf(request: HttpRequest) -> HttpResponse:
      return HttpResponse(status=204)
  ```
- Roles (editor vs reader, Google login in M2): check in one typed helper,
  e.g. `require_editor(request) -> User` that narrows `request.user` with
  `isinstance(user, User)` and raises `HttpError(403, ...)`. Do not inline
  `if not user.groups...` in every view. Services take a `User`, not
  `request.user` (which is `User | AnonymousUser` to mypy).
- `request.auth` is `Any` to mypy; don't use it.

## Pagination

```python
from django.db.models import QuerySet
from ninja.pagination import PageNumberPagination, paginate

@router.get("/", response=list[RecipeOut])
@paginate(PageNumberPagination, page_size=20)
def list_recipes(request: HttpRequest) -> QuerySet[Recipe]:
    return Recipe.objects.order_by("-created_at")
```

Return the unsliced, **ordered** QuerySet; `@paginate` slices it and wraps it
in `{"items": [...], "count": n}`. Pick one pagination class for the whole API
(set `NINJA_PAGINATION_CLASS`) so the frontend has one shape.

## Sync, not async

Views are plain `def`. The ORM and SQLite here are sync. Never write
`async def` views that call the ORM, never wrap ORM calls in
`sync_to_async` to "make it async", never call `asyncio.run` inside a view.
Slow work (AI photo import) is a separate decision — ask, don't improvise.

## Typing (`mypy --strict` + django-stubs)

- Ninja ships `py.typed`; no `# type: ignore` on Ninja imports.
- Annotate every function, including tests and fixtures. `list[X]`,
  `X | None` (no `typing.List`/`Optional`).
- `QuerySet[Model]` and `Model.objects` are typed by django-stubs; don't cast
  to `Any`. Fix the type rather than ignoring it; any `# type: ignore` needs
  a specific code and a reason.

## OpenAPI → TypeScript

```
uv run python manage.py export_openapi_schema --api <project>.api.api \
  --output openapi.json --indent 2 --sorted
```

The schema file is the contract for the Angular app's generated types. After
any change to a schema, route or response code, regenerate it and the
TypeScript types in the same commit; CI fails if they drift.

## Testing

See [references/testing.md](references/testing.md) for `TestClient`,
fixtures, auth and CSRF tests.

## Don't

- DRF anything (serializers, viewsets, `Response`, `status.HTTP_...`).
- Untyped views, `dict` payloads, `**kwargs` views, returning raw `dict`s
  where a schema exists.
- Business logic or multi-step ORM writes in `api.py`.
- `fields="__all__"`, one schema used for both input and output.
- `async def` views, `sync_to_async` sprinkled around ORM calls.
- `csrf_exempt`, or unauthenticated mutating endpoints.
- A second `NinjaAPI`, or URLs defined outside the routers.
- Hand-written TypeScript interfaces for API data.
