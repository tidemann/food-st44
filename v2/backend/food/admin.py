from typing import TYPE_CHECKING, Any
from urllib.parse import urlencode

from django.contrib import admin
from django.contrib.auth.models import User
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect

from food.auth import admin_emails
from food.models import Editor


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
else:
    _EditorAdminBase = admin.ModelAdmin


@admin.register(Editor, site=site)
class EditorAdmin(_EditorAdminBase):
    list_display = ("email", "name", "added_at")
    search_fields = ("email", "name")
    fields = ("email", "name")
