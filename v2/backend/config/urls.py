from django.urls import URLPattern, URLResolver, path, re_path

from food.api import api
from food.views import spa

urlpatterns: list[URLPattern | URLResolver] = [
    # The front page is the SPA. Listed first: api.urls has its own "" route (Ninja's default
    # home), which would otherwise answer / with a 404.
    path("", spa),
    path("", api.urls),
    # Anything that is not API or a static file is a client-side route.
    re_path(r"^(?!api/|static/).*$", spa),
]
