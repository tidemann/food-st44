from typing import Literal

from django.http import HttpRequest
from ninja import NinjaAPI, Schema

# Mounted at the site root so /healthz keeps the deploy contract. Everything else goes under
# /api/ (add routers with api.add_router("/api/...")), which the SPA fallback never catches.
api = NinjaAPI(
    title="food.st44.no",
    version="2",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)


class Health(Schema):
    status: Literal["ok"]


@api.get("/healthz", response=Health, operation_id="healthz")
def healthz(request: HttpRequest) -> Health:
    return Health(status="ok")
