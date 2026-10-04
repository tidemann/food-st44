from django.urls import URLPattern, URLResolver, path, re_path

from food.api import api
from food.views import spa

urlpatterns: list[URLPattern | URLResolver] = [
    # The front page is the SPA. Mounted at the root, Ninja adds its own "home" view at "",
    # which 404s when the docs live elsewhere, so this has to come before api.urls.
    path("", spa),
    path("", api.urls),
    # Anything that is not API or a static file is a client-side route.
    re_path(r"^(?!api/|static/).*$", spa),
]
