from django.urls import URLPattern, URLResolver, include, path, re_path

from food import mcp, oauth
from food.admin import site as admin_site
from food.api import api
from food.views import (
    healthz,
    not_found,
    photo,
    recipe_action,
    recipe_cook,
    recipe_detail,
    spa,
)

# The client routes (frontend/src/app/app.routes.ts) mirrored here, so a path the SPA would
# answer with a 404 page also gets a 404 status. A trailing slash is accepted, as in v1.
urlpatterns: list[URLPattern | URLResolver] = [
    path("healthz", healthz),
    # The editor list (food.admin). Under /api/ like every other non-SPA path.
    path("api/admin/", admin_site.urls),
    # The MCP server (ST-833): JSON-RPC over POST, not a REST endpoint, so not in the API schema.
    path("api/mcp", mcp.endpoint),
    # The Claude app's sign-in to it (ST-834): OAuth under /api/oauth/, and the two metadata
    # documents the spec puts at /.well-known/ in the root, the one exception to the SPA rule.
    # The library's namespace, so its metadata views find the endpoints by name.
    path("", include((oauth.urlpatterns, "oauth2_provider"))),
    # The front page is the SPA. Mounted at the root, Ninja adds its own "home" view at "",
    # which 404s when the docs live elsewhere, so this has to come before api.urls.
    path("", spa),
    path("", api.urls),
    re_path(r"^recipes/new/?$", spa),
    # From a photo (M4), a link or pasted text (M5).
    re_path(r"^recipes/new/(?:photo|link|text)/?$", spa),
    re_path(r"^recipes/(?P<raw_id>[^/]+)/?$", recipe_detail),
    re_path(r"^recipes/(?P<raw_id>[^/]+)/(?:edit|delete)/?$", recipe_action),
    re_path(r"^recipes/(?P<raw_id>[^/]+)/cook/?$", recipe_cook),
    # Connecting an assistant (ST-833): the help page, and the editor's keys.
    re_path(r"^assistent/?$", spa),
    re_path(r"^assistent/nokler(?:/ny)?/?$", spa),
    re_path(r"^assistent/nokler/\d+/slett/?$", spa),
    # The Claude app's approval step (ST-834); food.oauth sends the browser here.
    re_path(r"^assistent/godkjenn/?$", spa),
    # The week plan (ST-1231) and one day of it. The SPA shows "Ingen tilgang" to non-editors;
    # the plan itself only comes from /api/plan, which refuses them.
    re_path(r"^ukeplan/?$", spa),
    re_path(r"^ukeplan/\d{4}-\d{2}-\d{2}/?$", spa),
    # Recipe photos (food.photos), stored next to the database rather than built into the image.
    path("photos/<str:name>", photo),
    # Anything else that is not API or a static file is the SPA's "page not found".
    re_path(r"^(?!api/|static/).*$", not_found),
]
