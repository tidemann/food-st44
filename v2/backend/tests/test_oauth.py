"""The Claude app's sign-in to /api/mcp (ST-834): the whole OAuth flow as the app runs it."""

import base64
import hashlib
import json
import secrets
from datetime import timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qs, urlencode, urlsplit

import pytest
from django.contrib.auth.models import User
from django.test import Client
from django.utils import timezone
from oauth2_provider.models import get_access_token_model
from pytest_django import Settings

from food import mcp, oauth
from food.models import Editor, McpChange, Recipe

if TYPE_CHECKING:
    from django.test.client import _MonkeyPatchedWSGIResponse as Response

pytestmark = pytest.mark.django_db

SITE = "https://food.st44.no"
RESOURCE = f"{SITE}/api/mcp"
CALLBACK = "https://claude.ai/api/mcp/auth_callback"
JSON = "application/json"


@pytest.fixture(autouse=True)
def site(settings: Settings, tmp_path: Path) -> None:
    settings.FOOD_SITE_URL = SITE
    settings.FOOD_ADMIN_EMAILS = ["stig@example.com"]
    (tmp_path / "index.html").write_text("<app-root></app-root>", encoding="utf-8")
    settings.SPA_DIR = tmp_path


def person(email: str, *, editor: bool) -> User:
    user = User.objects.create(username=f"google:{email}", email=email, first_name="Åse Berg")
    if editor:
        Editor.objects.create(email=email)
    return user


def register(client: Client) -> str:
    """What the app does first (RFC 7591): register as a public client, no secret."""
    metadata = {
        "client_name": "Claude",
        "redirect_uris": [CALLBACK],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    }
    response = client.post("/api/oauth/register/", json.dumps(metadata), content_type=JSON)
    assert response.status_code == 201, response.content
    body = response.json()
    assert "client_secret" not in body
    client_id: str = body["client_id"]
    return client_id


def pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode()).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def authorize_query(client_id: str, challenge: str, **extra: str) -> str:
    query = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": CALLBACK,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": "st-834",
        "scope": "read write",
        "resource": RESOURCE,
        **extra,
    }
    return urlencode({key: value for key, value in query.items() if value})


def approve(client: Client, query: str, *, allow: bool = True) -> dict[str, list[str]]:
    """The browser's part: /authorize → the SPA's page → its form posted back. Answers the
    query string the app's callback receives."""
    response = client.get(f"/api/oauth/authorize/?{query}")
    assert response.status_code == 302
    assert response["Location"] == f"/assistent/godkjenn?{query}"

    shown = client.get(f"/api/oauth/approval?{query}")
    assert shown.status_code == 200, shown.content
    form = dict(shown.json()["fields"])
    if allow:
        form["allow"] = "on"
    posted = client.post("/api/oauth/authorize/", form)
    assert posted.status_code == 302
    location = urlsplit(posted["Location"])
    assert f"{location.scheme}://{location.netloc}{location.path}" == CALLBACK
    return parse_qs(location.query)


def token(client: Client, **form: str) -> dict[str, Any]:
    response = client.post(
        "/api/oauth/token/", urlencode(form), "application/x-www-form-urlencoded"
    )
    body: dict[str, Any] = response.json()
    body["status"] = response.status_code
    return body


def sign_in_with_app(client: Client, user: User) -> dict[str, Any]:
    """The whole flow, as the Claude app and the person in the browser do it."""
    client_id = register(client)
    verifier, challenge = pkce()
    client.force_login(user)
    answer = approve(client, authorize_query(client_id, challenge))
    assert answer["state"] == ["st-834"]
    assert answer["iss"] == [SITE]
    client.logout()  # the app's own requests carry no cookie
    tokens = token(
        client,
        grant_type="authorization_code",
        code=answer["code"][0],
        redirect_uri=CALLBACK,
        client_id=client_id,
        code_verifier=verifier,
        resource=RESOURCE,
    )
    assert tokens["status"] == 200, tokens
    tokens["client_id"] = client_id
    return tokens


def mcp_call(client: Client, access_token: str, tool: str, **arguments: object) -> "Response":
    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": tool, "arguments": arguments},
    }
    return client.post(
        "/api/mcp",
        json.dumps(body),
        content_type=JSON,
        headers={"Authorization": f"Bearer {access_token}"},
    )


def wrote(response: "Response") -> dict[str, Any]:
    assert response.status_code == 200
    result: dict[str, Any] = response.json()["result"]
    assert result["isError"] is False, result
    structured: dict[str, Any] = result["structuredContent"]
    return structured


def refusal(response: "Response") -> str:
    assert response.status_code == 200
    result = response.json()["result"]
    assert result["isError"] is True
    text: str = result["content"][0]["text"]
    return text


def challenged(response: "Response") -> None:
    """Refused at the HTTP level, so the app refreshes or signs in again (RFC 6750, RFC 9728)."""
    assert response.status_code == 401
    header = response["WWW-Authenticate"]
    assert header.startswith("Bearer ")
    assert 'error="invalid_token"' in header
    assert f'resource_metadata="{SITE}/.well-known/oauth-protected-resource/api/mcp"' in header


# --- the metadata the app reads first


def test_protected_resource_metadata(client: Client) -> None:
    for path in (
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/api/mcp",
    ):
        response = client.get(path)
        assert response.status_code == 200
        body = response.json()
        assert body["resource"] == RESOURCE
        assert body["authorization_servers"] == [SITE]
        assert body["scopes_supported"] == ["read", "write"]
        assert body["bearer_methods_supported"] == ["header"]


def test_authorization_server_metadata(client: Client) -> None:
    response = client.get("/.well-known/oauth-authorization-server")
    assert response.status_code == 200
    body = response.json()
    assert body["issuer"] == SITE
    assert body["authorization_endpoint"] == f"{SITE}/api/oauth/authorize/"
    assert body["token_endpoint"] == f"{SITE}/api/oauth/token/"
    assert body["registration_endpoint"] == f"{SITE}/api/oauth/register/"
    assert body["revocation_endpoint"] == f"{SITE}/api/oauth/revoke_token/"
    assert body["response_types_supported"] == ["code"]
    assert body["grant_types_supported"] == ["authorization_code", "refresh_token"]
    assert body["code_challenge_methods_supported"] == ["S256"]
    assert "none" in body["token_endpoint_auth_methods_supported"]
    assert body["authorization_response_iss_parameter_supported"] is True


def test_other_well_known_paths_are_still_the_spas_404(client: Client) -> None:
    response = client.get("/.well-known/openid-configuration")
    assert response.status_code == 404
    assert "<app-root>" in response.text


# --- the flow end to end


def test_an_editor_signs_in_and_the_app_writes(client: Client) -> None:
    tokens = sign_in_with_app(client, person("kari@example.com", editor=True))
    assert tokens["token_type"] == "Bearer"  # noqa: S105 (the scheme, not a secret)
    assert tokens["expires_in"] == 3600
    assert set(tokens["scope"].split()) == {"read", "write"}
    assert tokens["refresh_token"]

    made = wrote(
        mcp_call(
            client, tokens["access_token"], "create_recipe", title="Fårikål", ingredients="lam"
        )
    )
    assert Recipe.objects.get().id == made["id"]
    change = McpChange.objects.get()
    assert change.via == "Claude app"
    assert change.user is not None
    assert change.user.email == "kari@example.com"
    assert change.tool == "create_recipe"


def test_someone_not_signed_in_goes_through_google_first(client: Client) -> None:
    client_id = register(client)
    query = authorize_query(client_id, pkce()[1])
    response = client.get(f"/api/oauth/authorize/?{query}")
    assert response.status_code == 302
    login = urlsplit(response["Location"])
    assert login.path == "/api/auth/google/login"
    # Back to the same authorize request after the sign-in.
    assert parse_qs(login.query)["next"] == [f"/api/oauth/authorize/?{query}"]


def test_the_approval_page_shows_who_and_what(client: Client) -> None:
    client_id = register(client)
    client.force_login(person("kari@example.com", editor=True))
    shown = client.get(f"/api/oauth/approval?{authorize_query(client_id, pkce()[1])}").json()
    assert shown["client_name"] == "Claude"
    assert shown["client_host"] == "claude.ai"
    assert (shown["name"], shown["email"], shown["initial"]) == (
        "Åse Berg",
        "kari@example.com",
        "Å",
    )
    assert shown["can_write"] is True
    assert shown["fields"]["client_id"] == client_id
    assert shown["fields"]["redirect_uri"] == CALLBACK
    assert shown["fields"]["resource"] == RESOURCE


def test_the_approval_page_needs_a_sign_in_and_a_good_request(client: Client) -> None:
    client_id = register(client)
    query = authorize_query(client_id, pkce()[1])
    assert client.get(f"/api/oauth/approval?{query}").status_code == 401
    client.force_login(person("kari@example.com", editor=True))
    broken = client.get(f"/api/oauth/approval?{authorize_query('nobody', pkce()[1])}")
    assert broken.status_code == 400
    assert broken.json() == {"detail": oauth.BROKEN_LINK}


def test_avvis_sends_the_app_access_denied(client: Client) -> None:
    client_id = register(client)
    client.force_login(person("kari@example.com", editor=True))
    answer = approve(client, authorize_query(client_id, pkce()[1]), allow=False)
    assert answer["error"] == ["access_denied"]
    assert "code" not in answer


def test_the_approval_form_needs_the_csrf_token() -> None:
    client = Client(enforce_csrf_checks=True)
    client_id = register(client)
    client.force_login(person("kari@example.com", editor=True))
    query = authorize_query(client_id, pkce()[1])
    shown = client.get(f"/api/oauth/approval?{query}")
    form = dict(shown.json()["fields"], allow="on")
    assert client.post("/api/oauth/authorize/", form).status_code == 403

    # The answer the page fetched set the cookie; the page posts its value, as Django names it.
    cookie = shown.cookies["XSRF-TOKEN"].value
    posted = client.post("/api/oauth/authorize/", {**form, "csrfmiddlewaretoken": cookie})
    assert posted.status_code == 302
    assert posted["Location"].startswith(f"{CALLBACK}?code=")


def test_pkce_is_required(client: Client) -> None:
    client_id = register(client)
    client.force_login(person("kari@example.com", editor=True))
    query = authorize_query(client_id, "", code_challenge_method="")
    response = client.get(f"/api/oauth/authorize/?{query}")
    assert response.status_code == 302
    answer = parse_qs(urlsplit(response["Location"]).query)
    assert answer["error"] == ["invalid_request"]


def test_plain_pkce_is_refused(client: Client) -> None:
    client_id = register(client)
    client.force_login(person("kari@example.com", editor=True))
    verifier = secrets.token_urlsafe(48)
    # Refused when the code would be made, so the app hears it at its callback.
    answer = approve(client, authorize_query(client_id, verifier, code_challenge_method="plain"))
    assert answer["error"] == ["invalid_request"]
    assert "code" not in answer


def test_the_code_needs_the_right_verifier(client: Client) -> None:
    client_id = register(client)
    _, challenge = pkce()
    client.force_login(person("kari@example.com", editor=True))
    answer = approve(client, authorize_query(client_id, challenge))
    tokens = token(
        client,
        grant_type="authorization_code",
        code=answer["code"][0],
        redirect_uri=CALLBACK,
        client_id=client_id,
        code_verifier=pkce()[0],
    )
    assert tokens["status"] == 400
    assert tokens["error"] == "invalid_grant"


def test_a_redirect_uri_that_is_not_https_cannot_register(client: Client) -> None:
    metadata = {"redirect_uris": ["http://evil.example/cb"], "token_endpoint_auth_method": "none"}
    response = client.post("/api/oauth/register/", json.dumps(metadata), content_type=JSON)
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_client_metadata"


# --- refresh, expiry, bad tokens


def test_the_token_refreshes_and_the_old_refresh_token_is_spent(client: Client) -> None:
    first = sign_in_with_app(client, person("kari@example.com", editor=True))
    second = token(
        client,
        grant_type="refresh_token",
        refresh_token=first["refresh_token"],
        client_id=first["client_id"],
    )
    assert second["status"] == 200, second
    assert second["access_token"] != first["access_token"]
    assert second["refresh_token"] != first["refresh_token"]
    wrote(mcp_call(client, second["access_token"], "create_recipe", title="x", ingredients="y"))

    again = token(
        client,
        grant_type="refresh_token",
        refresh_token=first["refresh_token"],
        client_id=first["client_id"],
    )
    assert again["status"] == 400
    assert again["error"] == "invalid_grant"


def test_an_expired_token_is_refused_with_a_challenge(client: Client) -> None:
    tokens = sign_in_with_app(client, person("kari@example.com", editor=True))
    get_access_token_model().objects.filter().update(expires=timezone.now() - timedelta(seconds=1))
    challenged(mcp_call(client, tokens["access_token"], "search_recipes"))
    challenged(
        mcp_call(client, tokens["access_token"], "create_recipe", title="x", ingredients="y")
    )
    assert Recipe.objects.count() == 0


@pytest.mark.parametrize("bad", ["nonsense", "Bearer", "a" * 200])
def test_an_unknown_token_is_refused_with_a_challenge(client: Client, bad: str) -> None:
    challenged(mcp_call(client, bad, "search_recipes"))


def test_a_revoked_token_is_refused(client: Client) -> None:
    tokens = sign_in_with_app(client, person("kari@example.com", editor=True))
    form = {"token": tokens["access_token"], "client_id": tokens["client_id"]}
    response = client.post(
        "/api/oauth/revoke_token/", urlencode(form), "application/x-www-form-urlencoded"
    )
    assert response.status_code == 200
    challenged(mcp_call(client, tokens["access_token"], "search_recipes"))


def test_the_registration_token_opens_nothing(client: Client) -> None:
    metadata = {"redirect_uris": [CALLBACK], "token_endpoint_auth_method": "none"}
    registered = client.post("/api/oauth/register/", json.dumps(metadata), content_type=JSON)
    challenged(mcp_call(client, registered.json()["registration_access_token"], "search_recipes"))


def test_a_token_for_another_resource_is_refused(client: Client) -> None:
    client_id = register(client)
    verifier, challenge = pkce()
    client.force_login(person("kari@example.com", editor=True))
    query = authorize_query(client_id, challenge, resource="https://other.example/api")
    answer = approve(client, query)
    tokens = token(
        client,
        grant_type="authorization_code",
        code=answer["code"][0],
        redirect_uri=CALLBACK,
        client_id=client_id,
        code_verifier=verifier,
    )
    assert tokens["status"] == 200, tokens
    challenged(mcp_call(client, tokens["access_token"], "search_recipes"))


# --- who may write


def test_a_non_editor_gets_a_read_token(client: Client) -> None:
    user = person("ola@example.com", editor=False)
    client_id = register(client)
    client.force_login(user)
    shown = client.get(f"/api/oauth/approval?{authorize_query(client_id, pkce()[1])}").json()
    assert shown["can_write"] is False

    tokens = sign_in_with_app(client, user)
    assert tokens["scope"] == "read"
    Recipe.objects.create(title="Sveler", ingredients="mel")
    assert wrote(mcp_call(client, tokens["access_token"], "search_recipes"))["count"] == 1
    for tool, args in (
        ("create_recipe", {"title": "x", "ingredients": "y"}),
        ("update_recipe", {"id": 1, "title": "z"}),
        ("import_recipe_from_link", {"url": "https://example.com/"}),
    ):
        assert refusal(mcp_call(client, tokens["access_token"], tool, **args)) == (
            mcp.APP_NOT_AN_EDITOR
        )
    assert Recipe.objects.get().title == "Sveler"
    assert McpChange.objects.count() == 0


def test_an_editor_taken_off_the_list_cannot_write_any_more(client: Client) -> None:
    tokens = sign_in_with_app(client, person("kari@example.com", editor=True))
    Editor.objects.all().delete()
    message = refusal(
        mcp_call(client, tokens["access_token"], "create_recipe", title="x", ingredients="y")
    )
    assert message == mcp.APP_NOT_AN_EDITOR
    assert Recipe.objects.count() == 0


def test_a_read_token_stays_read_only_when_its_user_becomes_an_editor(client: Client) -> None:
    tokens = sign_in_with_app(client, person("ola@example.com", editor=False))
    Editor.objects.create(email="ola@example.com")
    message = refusal(
        mcp_call(client, tokens["access_token"], "create_recipe", title="x", ingredients="y")
    )
    assert message == mcp.APP_READ_ONLY


def test_an_admin_email_counts_as_an_editor(client: Client) -> None:
    tokens = sign_in_with_app(client, person("stig@example.com", editor=False))
    wrote(mcp_call(client, tokens["access_token"], "create_recipe", title="x", ingredients="y"))


def test_reads_still_need_no_token(client: Client) -> None:
    body = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}
    response = client.post("/api/mcp", json.dumps(body), content_type=JSON)
    assert response.status_code == 200


# --- the routes around it


@pytest.mark.parametrize("path", ["/assistent/godkjenn", "/assistent/godkjenn/"])
def test_the_approval_page_is_the_spa(client: Client, path: str) -> None:
    response = client.get(path)
    assert response.status_code == 200
    assert "<app-root>" in response.text


def test_healthz_is_still_ok(client: Client) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.content == b"ok"
