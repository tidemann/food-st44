import base64
import json
import time
from io import BytesIO
from typing import Any
from urllib.error import URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request

import pytest
from django.contrib.auth.models import User
from django.test import Client
from pytest_django import Settings

from food.auth import FAILED
from food.models import Editor, Recipe

pytestmark = pytest.mark.django_db

JSON = "application/json"
CLIENT_ID = "test-client.apps.googleusercontent.com"
RECIPE = {"title": "Sveler", "ingredients": "mel\nmelk"}


@pytest.fixture(autouse=True)
def google_client(settings: Settings) -> None:
    settings.GOOGLE_CLIENT_ID = CLIENT_ID
    settings.GOOGLE_CLIENT_SECRET = "test-secret"  # noqa: S105
    settings.GOOGLE_REDIRECT_URI = "https://food.st44.no/api/auth/google/callback"
    settings.FOOD_ADMIN_EMAILS = ["stig@example.com"]


def sign_in_as(client: Client, email: str, name: str = "Kari Nordmann") -> User:
    user = User.objects.create(username=f"google:{email}", email=email, first_name=name)
    client.force_login(user)
    return user


def make() -> Recipe:
    return Recipe.objects.create(title="Lapskaus", ingredients="x")


# --- recipe writes: 403 unless an editor ---


def write_statuses(client: Client) -> list[int]:
    recipe = make()
    return [
        client.post("/api/recipes", RECIPE, content_type=JSON).status_code,
        client.put(f"/api/recipes/{recipe.id}", RECIPE, content_type=JSON).status_code,
        client.delete(f"/api/recipes/{recipe.id}").status_code,
    ]


def test_anonymous_can_read_but_not_write(client: Client) -> None:
    recipe = make()
    assert client.get("/api/recipes").status_code == 200
    assert client.get(f"/api/recipes/{recipe.id}").status_code == 200

    assert write_statuses(client) == [403, 403, 403]
    assert Recipe.objects.filter(title="Sveler").count() == 0
    assert Recipe.objects.count() == 2  # the one above and write_statuses' own; none deleted


def test_a_signed_in_non_editor_cannot_write(client: Client) -> None:
    sign_in_as(client, "gjest@example.com")
    assert write_statuses(client) == [403, 403, 403]
    response = client.post("/api/recipes", RECIPE, content_type=JSON)
    assert response.json() == {"detail": "Bare husstandens redaktører kan endre oppskrifter."}


def test_an_editor_on_the_list_can_write(client: Client) -> None:
    Editor.objects.create(email="kari@example.com")
    sign_in_as(client, "Kari@Example.com")
    assert write_statuses(client) == [201, 200, 204]


def test_an_admin_email_is_an_editor_without_a_list_entry(client: Client) -> None:
    sign_in_as(client, "stig@example.com")
    assert write_statuses(client) == [201, 200, 204]


def test_an_inactive_editor_cannot_write(client: Client) -> None:
    Editor.objects.create(email="kari@example.com")
    user = sign_in_as(client, "kari@example.com")
    user.is_active = False
    user.save()
    assert write_statuses(client) == [403, 403, 403]


def test_writes_check_csrf_with_angulars_cookie_and_header(client: Client) -> None:
    Editor.objects.create(email="kari@example.com")
    csrf_client = Client(enforce_csrf_checks=True)
    csrf_client.force_login(User.objects.create(username="google:k", email="kari@example.com"))

    assert csrf_client.post("/api/recipes", RECIPE, content_type=JSON).status_code == 403

    token = csrf_client.get("/api/auth/me").cookies["XSRF-TOKEN"].value
    response = csrf_client.post(
        "/api/recipes", RECIPE, content_type=JSON, headers={"X-XSRF-Token": token}
    )
    assert response.status_code == 201


# --- /api/auth/me and sign-out ---


def test_me_signed_out(client: Client) -> None:
    assert client.get("/api/auth/me").json() == {
        "signed_in": False,
        "name": "",
        "initial": "",
        "is_editor": False,
        "sign_in_available": True,
    }


def test_me_without_a_google_client_says_sign_in_is_unavailable(
    client: Client, settings: Settings
) -> None:
    settings.GOOGLE_CLIENT_ID = ""
    assert client.get("/api/auth/me").json()["sign_in_available"] is False
    assert client.get("/api/auth/google/login").status_code == 503
    assert client.get("/api/recipes").status_code == 200


def test_me_signed_in_editor_and_non_editor(client: Client) -> None:
    Editor.objects.create(email="kari@example.com")
    sign_in_as(client, "kari@example.com", name="kari Nordmann")
    assert client.get("/api/auth/me").json() == {
        "signed_in": True,
        "name": "kari Nordmann",
        "initial": "K",
        "is_editor": True,
        "sign_in_available": True,
    }

    sign_in_as(client, "ola@example.com", name="")
    me = client.get("/api/auth/me").json()
    assert (me["name"], me["initial"], me["is_editor"]) == ("ola@example.com", "O", False)


def test_logout_ends_the_session(client: Client) -> None:
    sign_in_as(client, "kari@example.com")
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").json()["signed_in"] is False


# --- Google sign-in, with Google's token endpoint mocked ---


def id_token(overrides: dict[str, Any]) -> str:
    claims = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "exp": int(time.time()) + 300,
        "sub": "1234567890",
        "email": "Kari@Example.com",
        "email_verified": True,
        "name": "Kari Nordmann",
    } | overrides
    part = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    return f"eyJhbGciOiJSUzI1NiJ9.{part}.signature"


class FakeGoogle:
    """Stands in for urlopen on Google's token endpoint and records what it was sent."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.claims: dict[str, Any] = {}
        self.body: dict[str, Any] | None = None
        self.error: Exception | None = None
        self.sent: dict[str, list[str]] = {}
        self.nonce = ""  # the one our login sent to Google; a real token echoes it
        monkeypatch.setattr("food.google.urlopen", self)

    def __call__(self, request: Request, timeout: float) -> BytesIO:
        assert request.full_url == "https://oauth2.googleapis.com/token"
        assert isinstance(request.data, bytes)
        self.sent = parse_qs(request.data.decode())
        if self.error is not None:
            raise self.error
        body = self.body or {"id_token": id_token({"nonce": self.nonce} | self.claims)}
        return BytesIO(json.dumps(body).encode())


@pytest.fixture
def google(monkeypatch: pytest.MonkeyPatch) -> FakeGoogle:
    return FakeGoogle(monkeypatch)


def start(client: Client, google: FakeGoogle, next_path: str = "/recipes/3") -> str:
    """Begin a sign-in; returns the state Google would echo back."""
    response = client.get("/api/auth/google/login", {"next": next_path})
    assert response.status_code == 302
    url = urlsplit(response["Location"])
    query = {key: values[0] for key, values in parse_qs(url.query).items()}
    assert f"{url.scheme}://{url.netloc}{url.path}" == (
        "https://accounts.google.com/o/oauth2/v2/auth"
    )
    assert query["client_id"] == CLIENT_ID
    assert query["redirect_uri"] == "https://food.st44.no/api/auth/google/callback"
    assert query["response_type"] == "code"
    assert query["scope"] == "openid email profile"
    google.nonce = query["nonce"]
    return query["state"]


def test_google_sign_in_signs_in_and_returns_to_next(client: Client, google: FakeGoogle) -> None:
    state = start(client, google)
    response = client.get("/api/auth/google/callback", {"code": "the-code", "state": state})

    assert response.status_code == 302
    assert response["Location"] == "/recipes/3"
    assert google.sent["code"] == ["the-code"]
    assert google.sent["client_secret"] == ["test-secret"]
    assert google.sent["grant_type"] == ["authorization_code"]
    user = User.objects.get(username="google:1234567890")
    assert (user.email, user.first_name, user.is_staff) == (
        "kari@example.com",
        "Kari Nordmann",
        False,
    )
    me = client.get("/api/auth/me").json()
    assert (me["signed_in"], me["name"], me["is_editor"]) == (True, "Kari Nordmann", False)


def test_signing_in_again_updates_the_same_user(client: Client, google: FakeGoogle) -> None:
    for name in ("Kari", "Kari Nordmann"):
        google.claims = {"name": name}
        client.get("/api/auth/google/callback", {"code": "c", "state": start(client, google)})
    assert list(User.objects.values_list("first_name", flat=True)) == ["Kari Nordmann"]


def test_an_admin_email_signs_in_as_staff(client: Client, google: FakeGoogle) -> None:
    google.claims = {"email": "stig@example.com"}
    client.get("/api/auth/google/callback", {"code": "c", "state": start(client, google)})
    assert User.objects.get().is_staff is True


@pytest.mark.parametrize("next_path", ["https://evil.example/", "//evil.example/x", "recipes"])
def test_next_must_be_a_path_on_this_site(
    client: Client, google: FakeGoogle, next_path: str
) -> None:
    state = start(client, google, next_path)
    response = client.get("/api/auth/google/callback", {"code": "c", "state": state})
    assert response["Location"] == "/"


@pytest.mark.parametrize(
    "claims",
    [
        {"aud": "someone-else.apps.googleusercontent.com"},
        {"iss": "https://evil.example"},
        {"exp": int(time.time()) - 10},
        {"email_verified": False},
        {"nonce": "replayed"},
        {"email": ""},
    ],
)
def test_a_token_we_do_not_accept_signs_nobody_in(
    client: Client, google: FakeGoogle, claims: dict[str, Any]
) -> None:
    google.claims = claims
    response = client.get(
        "/api/auth/google/callback", {"code": "c", "state": start(client, google)}
    )
    assert response["Location"] == FAILED
    assert client.get("/api/auth/me").json()["signed_in"] is False


def test_a_wrong_or_reused_state_is_refused(client: Client, google: FakeGoogle) -> None:
    state = start(client, google)
    bad = client.get("/api/auth/google/callback", {"code": "c", "state": "forged"})
    assert bad["Location"] == FAILED
    # The state is single-use: the first callback consumed it.
    again = client.get("/api/auth/google/callback", {"code": "c", "state": state})
    assert again["Location"] == FAILED
    assert google.sent == {}  # Google was never asked


def test_cancelling_on_googles_page_fails_cleanly(client: Client, google: FakeGoogle) -> None:
    state = start(client, google)
    response = client.get("/api/auth/google/callback", {"error": "access_denied", "state": state})
    assert response["Location"] == FAILED


@pytest.mark.parametrize("problem", ["unreachable", "no id_token"])
def test_a_google_failure_fails_cleanly(client: Client, google: FakeGoogle, problem: str) -> None:
    if problem == "unreachable":
        google.error = URLError("timed out")
    else:
        google.body = {"error": "invalid_grant"}
    response = client.get(
        "/api/auth/google/callback", {"code": "c", "state": start(client, google)}
    )
    assert response["Location"] == FAILED


# --- the admin page for the editor list ---


def test_admin_sends_a_signed_out_visitor_to_google_sign_in(client: Client) -> None:
    response = client.get("/api/admin/", follow=True)
    assert response.redirect_chain[-1][0].startswith("https://accounts.google.com/")
    first_hop = client.get("/api/admin/login/", {"next": "/api/admin/"})
    assert first_hop["Location"] == "/api/auth/google/login?next=%2Fapi%2Fadmin%2F"


def test_an_editor_who_is_not_an_admin_cannot_open_the_admin(client: Client) -> None:
    Editor.objects.create(email="kari@example.com")
    user = sign_in_as(client, "kari@example.com")
    user.is_staff = True  # even if staff, the address must be in FOOD_ADMIN_EMAILS
    user.save()
    assert client.get("/api/admin/food/editor/").status_code == 302


def test_an_admin_can_add_and_remove_an_editor(client: Client) -> None:
    user = sign_in_as(client, "stig@example.com", name="Stig")
    user.is_staff = user.is_superuser = True
    user.save()

    assert client.get("/api/admin/food/editor/").status_code == 200
    response = client.post(
        "/api/admin/food/editor/add/", {"email": " Kari@Example.com ", "name": "Kari"}
    )
    assert response.status_code == 302
    editor = Editor.objects.get()
    assert editor.email == "kari@example.com"

    response = client.post(f"/api/admin/food/editor/{editor.pk}/delete/", {"post": "yes"})
    assert response.status_code == 302
    assert not Editor.objects.exists()
