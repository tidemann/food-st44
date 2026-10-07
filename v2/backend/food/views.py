import re

from django.conf import settings
from django.http import FileResponse, Http404, HttpRequest, HttpResponse
from django.utils.html import escape

from food import photos
from food.models import Recipe

SITE = "food.st44.no"

# The same two sentences as the client-side 404 page (and v1's), so a crawler that runs no JS
# sees the title a browser ends up with.
RECIPE_NOT_FOUND = f"Fant ikke oppskriften — {SITE}"
PAGE_NOT_FOUND = f"Siden finnes ikke — {SITE}"

_TITLE = re.compile(r"<title>.*?</title>", re.DOTALL)
# JavaScript's parseInt: optional leading whitespace and "+", then digits; the rest is ignored.
_LEADING_INT = re.compile(r"\s*\+?(\d+)")
_MAX_ID = 2**31 - 1  # AutoField; a larger number is no recipe rather than an overflow


def parse_id(value: str) -> int | None:
    """v1's lenient id parse: "3abc" is recipe 3; "0", "-1" and "abc" are not a recipe."""
    match = _LEADING_INT.match(value)
    if match is None:
        return None
    recipe_id = int(match.group(1))
    return recipe_id if 0 < recipe_id <= _MAX_ID else None


def _index(title: str | None = None, status: int = 200) -> HttpResponse:
    """The Angular index.html, optionally with a server-side <title>."""
    index = settings.SPA_DIR / "index.html"
    if not index.is_file():
        raise Http404("frontend not built")
    html = index.read_text(encoding="utf-8")
    if title is not None:
        html = _TITLE.sub(lambda _: f"<title>{escape(title)}</title>", html, count=1)
    return HttpResponse(html, content_type="text/html; charset=utf-8", status=status)


def healthz(request: HttpRequest) -> HttpResponse:
    """The deploy contract, same as v1: 200 with the body `ok`. The deploy's public gate compares
    the body to `ok`, so this is plain text, not JSON, and not part of the API schema."""
    return HttpResponse("ok", content_type="text/plain; charset=utf-8")


def spa(request: HttpRequest) -> HttpResponse:
    """A client route that exists whatever is in the database: `/`, `/recipes/new` and its
    photo, link and text pages."""
    return _index()


def _find(raw_id: str) -> Recipe | None:
    recipe_id = parse_id(raw_id)
    return Recipe.objects.filter(pk=recipe_id).first() if recipe_id is not None else None


def recipe_detail(request: HttpRequest, raw_id: str) -> HttpResponse:
    """`/recipes/<id>`. v1's whole link preview is the <title>: it sends no description,
    og:* or twitter:* tags (inventory §3.7), so neither does v2."""
    recipe = _find(raw_id)
    if recipe is None:
        return _index(RECIPE_NOT_FOUND, status=404)
    return _index(f"{recipe.title} — {SITE}")


def recipe_cook(request: HttpRequest, raw_id: str) -> HttpResponse:
    """`/recipes/<id>/cook`: cooking mode, with the <title> the page sets (recipe-cook.ts)."""
    recipe = _find(raw_id)
    if recipe is None:
        return _index(RECIPE_NOT_FOUND, status=404)
    return _index(f"Matlaging: {recipe.title} — {SITE}")


def recipe_action(request: HttpRequest, raw_id: str) -> HttpResponse:
    """`/recipes/<id>/edit` and `/delete`: 404 when there is no such recipe."""
    if _find(raw_id) is None:
        return _index(RECIPE_NOT_FOUND, status=404)
    return _index()


def photo(request: HttpRequest, name: str) -> FileResponse:
    """`/photos/<name>`: a recipe photo from settings.PHOTOS_DIR. A name is never reused (a new
    upload gets a new one), so browsers may keep the file for good."""
    found = photos.path(name)
    if found is None:
        raise Http404("no such photo")
    response = FileResponse(found.open("rb"), content_type="image/webp")
    response["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


def not_found(request: HttpRequest) -> HttpResponse:
    """Any other path: the SPA still renders its "Siden finnes ikke" page, but with a real 404."""
    return _index(PAGE_NOT_FOUND, status=404)
