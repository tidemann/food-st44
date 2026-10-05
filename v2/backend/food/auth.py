"""Who may change recipes: Google sign-in, the Django session, and the editor list.

/api/auth/google/login sends the browser to Google; Google sends it back to
/api/auth/google/callback, which signs the account in with a normal Django session. Reads stay
public; recipe writes need `editor_auth`, which answers 403 to anyone not on the editor list.
"""

import secrets
from typing import Any

from django.conf import settings
from django.contrib.auth import login, logout
from django.contrib.auth.models import AbstractBaseUser, AnonymousUser, User
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.csrf import ensure_csrf_cookie
from ninja import Router, Schema, Status
from ninja.decorators import decorate_view
from ninja.errors import HttpError
from ninja.security import APIKeyCookie

from food import google
from food.models import Editor
from food.schemas import ErrorOut

router = Router(tags=["auth"])

_STATE = "google_state"
_NONCE = "google_nonce"
_NEXT = "google_next"
# Where a failed or cancelled sign-in lands; the SPA can show a message for it.
FAILED = "/?login=failed"


def admin_emails() -> set[str]:
    """FOOD_ADMIN_EMAILS: always editors, and the only accounts that may open the admin."""
    return {email.strip().lower() for email in settings.FOOD_ADMIN_EMAILS if email.strip()}


def is_editor(user: AbstractBaseUser | AnonymousUser) -> bool:
    if not isinstance(user, User) or not user.is_active or not user.email:
        return False
    email = user.email.lower()
    return email in admin_emails() or Editor.objects.filter(email__iexact=email).exists()


class EditorAuth(APIKeyCookie):
    """The session cookie, CSRF-checked, of a user on the editor list. Anyone else gets 403,
    signed in or not: the API has nothing for them to sign in *to* beyond what they have."""

    param_name = settings.SESSION_COOKIE_NAME

    def authenticate(self, request: HttpRequest, key: str | None) -> User:
        user = request.user
        if not isinstance(user, User) or not is_editor(user):
            raise HttpError(403, "Bare husstandens redaktører kan endre oppskrifter.")
        return user


editor_auth = EditorAuth()


class MeOut(Schema):
    signed_in: bool
    name: str
    initial: str  # first letter of the name (or email), upper-case; "" when signed out
    is_editor: bool
    # False when no Google client is configured: the SPA hides "Logg inn".
    sign_in_available: bool


@router.get("/me", response=MeOut, operation_id="get_me")
@decorate_view(ensure_csrf_cookie)  # the SPA echoes this cookie on its writes
def me(request: HttpRequest) -> dict[str, Any]:
    user = request.user
    signed_in = isinstance(user, User) and user.is_active
    name = ""
    if isinstance(user, User) and signed_in:
        name = user.first_name or user.email
    return {
        "signed_in": signed_in,
        "name": name,
        "initial": name[:1].upper(),
        "is_editor": is_editor(user),
        "sign_in_available": google.configured(),
    }


@router.post("/logout", response={204: None}, operation_id="logout")
def sign_out(request: HttpRequest) -> Status[None]:
    logout(request)
    return Status(204, None)


def _safe_next(value: str) -> str:
    """Only a path on this site: an open redirect would make the sign-in a phishing helper."""
    ok = value.startswith("/") and url_has_allowed_host_and_scheme(
        value, allowed_hosts=None, require_https=False
    )
    return value if ok else "/"


@router.get(
    "/google/login",
    response={302: None, 503: ErrorOut},
    operation_id="google_login",
    summary="Start Google sign-in (a browser navigation, not an XHR)",
)
def google_login(request: HttpRequest, next: str = "/") -> HttpResponse | Status[dict[str, str]]:
    if not google.configured():
        return Status(503, {"detail": "Innlogging er ikke satt opp."})
    state, nonce = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    request.session[_STATE] = state
    request.session[_NONCE] = nonce
    request.session[_NEXT] = _safe_next(next)
    return HttpResponseRedirect(google.authorize_url(state, nonce))


def _sign_in(request: HttpRequest, account: google.GoogleUser) -> None:
    """The Django user for this Google account, keyed by Google's stable id, updated from the
    token on every sign-in. Admin rights follow FOOD_ADMIN_EMAILS, so removing an address there
    takes them away at the next sign-in."""
    user, _ = User.objects.get_or_create(username=f"google:{account.sub}")
    user.email = account.email
    user.first_name = account.name[:150]
    user.is_staff = user.is_superuser = account.email in admin_emails()
    user.set_unusable_password()
    user.save()
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")


@router.get(
    "/google/callback",
    response={302: None},
    operation_id="google_callback",
    summary="Google's redirect target; signs in and redirects back into the site",
)
def google_callback(
    request: HttpRequest, code: str = "", state: str = "", error: str = ""
) -> HttpResponse:
    expected_state = request.session.pop(_STATE, None)
    nonce = request.session.pop(_NONCE, "")
    target = request.session.pop(_NEXT, "/")
    # `error` is set when the person cancels on Google's page.
    if error or not code or not expected_state or not secrets.compare_digest(state, expected_state):
        return HttpResponseRedirect(FAILED)
    try:
        account = google.exchange_code(code, nonce)
    except google.GoogleError:
        return HttpResponseRedirect(FAILED)
    _sign_in(request, account)
    return HttpResponseRedirect(target)
