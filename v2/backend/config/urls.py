from django.urls import URLPattern, URLResolver, path, re_path

from food.api import api
from food.views import spa

urlpatterns: list[URLPattern | URLResolver] = [
    path("", api.urls),
    # Anything that is not API or a static file is a client-side route.
    re_path(r"^(?!api/|static/).*$", spa),
]
