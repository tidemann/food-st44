from django.urls import URLPattern, URLResolver, path, re_path

from food.api import api
from food.views import not_found, recipe_action, recipe_detail, spa

# The client routes (frontend/src/app/app.routes.ts) mirrored here, so a path the SPA would
# answer with a 404 page also gets a 404 status. A trailing slash is accepted, as in v1.
urlpatterns: list[URLPattern | URLResolver] = [
    # The front page is the SPA. Mounted at the root, Ninja adds its own "home" view at "",
    # which 404s when the docs live elsewhere, so this has to come before api.urls.
    path("", spa),
    path("", api.urls),
    re_path(r"^recipes/new/?$", spa),
    re_path(r"^recipes/(?P<raw_id>[^/]+)/?$", recipe_detail),
    re_path(r"^recipes/(?P<raw_id>[^/]+)/(?:edit|delete)/?$", recipe_action),
    # Anything else that is not API or a static file is the SPA's "page not found".
    re_path(r"^(?!api/|static/).*$", not_found),
]
