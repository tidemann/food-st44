from typing import TYPE_CHECKING, Any
from urllib.parse import urlencode

from django.conf import settings
from django.contrib import admin
from django.contrib.auth.models import User
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect

from food import reader
from food.auth import admin_emails
from food.models import Editor, PhotoRead


class FoodAdminSite(admin.AdminSite):
    """The editor list, at /api/admin/. Sign-in is Google, like the rest of the site: there are
    no passwords. Only the addresses in FOOD_ADMIN_EMAILS get in."""

    site_header = "food.st44.no"
    site_title = "food.st44.no"
    index_title = "Hvem kan endre oppskrifter"
    site_url = "/"

    def has_permission(self, request: HttpRequest) -> bool:
        user = request.user
        # Checked live, not only from is_staff, so removing an address takes effect at once.
        return (
            isinstance(user, User)
            and user.is_active
            and user.is_staff
            and user.email.lower() in admin_emails()
        )

    def login(
        self, request: HttpRequest, extra_context: dict[str, Any] | None = None
    ) -> HttpResponse:
        target = request.GET.get("next") or "/api/admin/"
        return HttpResponseRedirect(f"/api/auth/google/login?{urlencode({'next': target})}")


site = FoodAdminSite(name="admin")

# ModelAdmin is generic only in django-stubs; at run time it cannot be subscripted.
if TYPE_CHECKING:
    _EditorAdminBase = admin.ModelAdmin[Editor]
    _PhotoReadAdminBase = admin.ModelAdmin[PhotoRead]
else:
    _EditorAdminBase = _PhotoReadAdminBase = admin.ModelAdmin


@admin.register(Editor, site=site)
class EditorAdmin(_EditorAdminBase):
    list_display = ("email", "name", "added_at")
    search_fields = ("email", "name")
    fields = ("email", "name")


@admin.register(PhotoRead, site=site)
class PhotoReadAdmin(_PhotoReadAdminBase):
    """Every "read recipe from photo", read-only: the count to set against the cost per photo
    (FOOD_AI_COST_PER_PHOTO), shown in a line above the list."""

    list_display = ("at", "editor", "provider", "model", "outcome")
    list_filter = ("provider", "outcome")
    date_hierarchy = "at"

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: PhotoRead | None = None) -> bool:
        return False

    def has_delete_permission(self, request: HttpRequest, obj: PhotoRead | None = None) -> bool:
        return False

    def changelist_view(
        self, request: HttpRequest, extra_context: dict[str, Any] | None = None
    ) -> HttpResponse:
        reading = reader.get_reader()
        context = {
            "photo_read_provider": reading.name if reading else "av (off)",
            "photo_read_cost": settings.FOOD_AI_COST_PER_PHOTO or "ikke oppgitt",
            "photo_read_count": PhotoRead.objects.count(),
            **(extra_context or {}),
        }
        return super().changelist_view(request, context)
