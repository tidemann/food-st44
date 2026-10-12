"""The Claude app's sign-in to the MCP server (ST-834): OAuth 2.1, as the MCP spec asks, by
django-oauth-toolkit. Nothing here makes or checks a token by hand.

How the app connects:

1. It reads /.well-known/oauth-protected-resource (RFC 9728), which names this site as the
   authorization server, and then /.well-known/oauth-authorization-server (RFC 8414).
2. It registers itself at /api/oauth/register/ (RFC 7591).
3. It opens /api/oauth/authorize/ in the browser, with a PKCE challenge. Someone not signed in
   goes through the site's Google sign-in first. The browser then lands on the SPA's approval
   page, /assistent/godkjenn, with the same query. The page asks GET /api/oauth/approval what to
   show and posts its form back to /api/oauth/authorize/.
4. The app trades the code at /api/oauth/token/ for an access token, good for an hour, and a
   refresh token, which is replaced on every use.

An editor's approval grants `read write`; anyone else's grants `read`. /api/mcp checks the
token's scope and the editor list on every write (food.mcp), so taking someone off the list
closes their token at once.
"""

from dataclasses import dataclass
from datetime import timedelta
from urllib.parse import urlsplit

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, AnonymousUser, User
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect, JsonResponse
from django.urls import URLPattern, path
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from ninja import Router, Schema, Status
from ninja.decorators import decorate_view
from oauth2_provider import views
from oauth2_provider.exceptions import OAuthToolkitError
from oauth2_provider.forms import AllowForm
from oauth2_provider.models import get_application_model
from oauth2_provider.oauth2_backends import get_oauthlib_core
from oauth2_provider.www_authenticate import build_bearer_challenge

from food.auth import is_editor
from food.models import ClientRegistration
from food.schemas import ErrorOut

READ = "read"
WRITE = "write"
# The SPA route that shows the approval step (frontend/src/app/assistant/approve.ts).
APPROVAL_PAGE = "/assistent/godkjenn"
# How a write through an OAuth token is named in the change log (McpChange.via).
VIA = "Claude app"
# The period settings.OAUTH_REGISTRATIONS_PER_HOUR counts over.
REGISTRATION_WINDOW = timedelta(hours=1)

BROKEN_LINK = "Lenken fra appen virker ikke. Start tilkoblingen på nytt fra Claude-appen."
SIGNED_OUT = "Du er ikke logget inn. Logg inn med Google-kontoen du bruker på food.st44.no."

# The fields the approval form posts back, as django-oauth-toolkit's AllowForm names them.
FORM_FIELDS = (
    "client_id",
    "redirect_uri",
    "response_type",
    "state",
    "code_challenge",
    "code_challenge_method",
)


def granted_scope(user: AbstractBaseUser | AnonymousUser) -> str:
    return f"{READ} {WRITE}" if is_editor(user) else READ


class Authorize(views.AuthorizationView):
    """django-oauth-toolkit's authorization endpoint, with the approval step in the SPA."""

    def render_to_response(self, context: dict[str, object], **kwargs: object) -> HttpResponse:
        """Where the library renders its own page (the approval form, or a request it cannot
        send back to the app), send the browser to the SPA's page with the same query. That
        page asks /api/oauth/approval, which says what to show or what is wrong."""
        return HttpResponseRedirect(f"{APPROVAL_PAGE}?{self.request.GET.urlencode()}")

    def form_valid(self, form: AllowForm) -> HttpResponse:
        # The scope follows the editor list, not what the form or the app asked for.
        form.cleaned_data["scope"] = granted_scope(self.request.user)
        return super().form_valid(form)


# --- what the approval page shows

router = Router(tags=["oauth"])


class ApprovalOut(Schema):
    client_name: str  # what the app calls itself, e.g. "Claude"
    client_host: str  # where the answer goes, e.g. "claude.ai"
    name: str
    email: str
    initial: str
    can_write: bool  # an editor: the app may add and change recipes
    # The hidden fields the page's form posts to /api/oauth/authorize/.
    fields: dict[str, str]


@router.get(
    "/approval",
    response={200: ApprovalOut, 400: ErrorOut, 401: ErrorOut},
    operation_id="get_oauth_approval",
    summary="What the approval page shows for an app's authorization request (same query)",
)
@decorate_view(ensure_csrf_cookie)  # the page's form posts this cookie's value back
def approval(request: HttpRequest) -> Status[dict[str, object]]:
    user = request.user
    if not isinstance(user, User) or not user.is_active:
        return Status(401, {"detail": SIGNED_OUT})
    try:
        scopes, credentials = get_oauthlib_core().validate_authorization_request(request)
    except OAuthToolkitError:
        return Status(400, {"detail": BROKEN_LINK})
    application = get_application_model().objects.get(client_id=credentials["client_id"])
    redirect_uri = str(credentials["redirect_uri"])
    host = urlsplit(redirect_uri).hostname or redirect_uri
    fields = {name: str(credentials[name]) for name in FORM_FIELDS if credentials.get(name)}
    fields["scope"] = " ".join(scopes)
    resources = request.GET.getlist("resource")
    if resources:
        fields["resource"] = " ".join(resources)
    name = user.first_name or user.email
    return Status(
        200,
        {
            "client_name": application.name or host,
            "client_host": host,
            "name": name,
            "email": user.email,
            "initial": name[:1].upper(),
            "can_write": is_editor(user),
            "fields": fields,
        },
    )


# --- the bearer tokens /api/mcp takes


@dataclass(frozen=True)
class AppAccess:
    user: User
    can_write: bool  # the token was granted `write`; the editor list is checked separately


def access_for(token: str) -> AppAccess | None:
    """Whose live token this is, or None: unknown, expired, revoked, issued for another
    resource, or not an access token for the recipes at all (e.g. a registration token)."""
    valid, verified = get_oauthlib_core().server.verify_request(
        settings.MCP_RESOURCE,
        http_method="POST",
        headers={"Authorization": f"Bearer {token}"},
        scopes=[READ],
    )
    user = verified.user
    if not valid or not isinstance(user, User) or not user.is_active:
        return None
    return AppAccess(user=user, can_write=WRITE in verified.scopes)


def challenge(request: HttpRequest) -> str:
    """The WWW-Authenticate header for a refused token: the app refreshes it or signs in
    again, and finds where through the metadata (RFC 9728 §5.1)."""
    return build_bearer_challenge(
        request,
        {"error": "invalid_token", "error_description": "The access token is not valid."},
        resource_metadata_url=f"{settings.FOOD_SITE_URL}/.well-known/oauth-protected-resource"
        + urlsplit(settings.MCP_RESOURCE).path,
    )


# --- registration, limited per address (ST-919)


def client_ip(request: HttpRequest) -> str:
    """The address a request came from. nginx-proxy, the only way in (the container publishes
    no port), puts its peer in X-Real-IP; without that header (a local run) the socket's."""
    return request.headers.get("X-Real-IP") or str(request.META.get("REMOTE_ADDR", ""))


class Register(views.DynamicClientRegistrationView):
    """django-oauth-toolkit's open registration (RFC 7591), at most
    OAUTH_REGISTRATIONS_PER_HOUR new apps an hour from one address; above that, 429. Each
    registration stores an application, so a loop must not be able to fill the table. The
    Claude app registers once per connection. Counted in the database, so both gunicorn workers
    and a restart see the same count."""

    def post(self, request: HttpRequest, *args: object, **kwargs: object) -> HttpResponse:
        ip = client_ip(request)
        now = timezone.now()
        ClientRegistration.objects.filter(at__lte=now - REGISTRATION_WINDOW).delete()
        recent = ClientRegistration.objects.filter(ip=ip).order_by("at")
        if recent.count() >= settings.OAUTH_REGISTRATIONS_PER_HOUR:
            first = recent.values_list("at", flat=True)[0]
            wait = first + REGISTRATION_WINDOW - now
            response = JsonResponse(
                {
                    "error": "too_many_requests",
                    "error_description": "Too many registrations from this address. Try later.",
                },
                status=429,
            )
            response["Retry-After"] = str(max(1, int(wait.total_seconds()) + 1))
            return response
        registered = super().post(request, *args, **kwargs)
        if registered.status_code == 201:
            ClientRegistration.objects.create(ip=ip, at=now)
        return registered


# --- the routes, mounted at the site root in config.urls under the library's namespace, so its
# metadata views find the endpoints by name.

_metadata = views.OAuthServerMetadataView.as_view()
_resource = views.OAuthProtectedResourceMetadataView.as_view()

urlpatterns: list[URLPattern] = [
    # The spec puts these two at the root: the one exception to "everything else is the SPA".
    path(".well-known/oauth-authorization-server", _metadata, name="oauth-server-metadata"),
    path(".well-known/oauth-protected-resource", _resource, name="oauth-resource-metadata"),
    # RFC 9728's form for a resource with a path: /.well-known/oauth-protected-resource/api/mcp.
    path(
        ".well-known/oauth-protected-resource/<path:resource_path>",
        _resource,
        name="oauth-resource-metadata-path",
    ),
    path("api/oauth/authorize/", Authorize.as_view(), name="authorize"),
    path("api/oauth/token/", views.TokenView.as_view(), name="token"),
    path("api/oauth/revoke_token/", views.RevokeTokenView.as_view(), name="revoke-token"),
    path(
        "api/oauth/register/",
        Register.as_view(),
        name="dcr-register",
    ),
    path(
        "api/oauth/register/<str:client_id>/",
        views.DynamicClientRegistrationManagementView.as_view(),
        name="dcr-register-management",
    ),
]
