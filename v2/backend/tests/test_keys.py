import hashlib

import pytest
from django.contrib.auth.models import User
from django.test import Client
from pytest_django import Settings

from food.keys import editor_for, make_key
from food.models import ApiKey, Editor

pytestmark = pytest.mark.django_db

JSON = "application/json"


@pytest.fixture(autouse=True)
def admins(settings: Settings) -> None:
    settings.FOOD_ADMIN_EMAILS = ["stig@example.com"]


def editor(client: Client, email: str = "kari@example.com") -> User:
    Editor.objects.create(email=email)
    user = User.objects.create(username=f"google:{email}", email=email, first_name="Kari")
    client.force_login(user)
    return user


def test_a_new_key_is_shown_once_and_stored_only_as_a_hash(client: Client) -> None:
    user = editor(client)

    response = client.post("/api/keys", {"name": " Samantha "}, content_type=JSON)

    assert response.status_code == 201
    body = response.json()
    token = body["token"]
    assert token.startswith("food_sk_")
    assert len(token) > 40
    assert body["name"] == "Samantha"
    assert body["prefix"] == token[:12]
    assert body["last_used_at"] is None
    key = ApiKey.objects.get()
    assert key.user == user
    assert key.token_hash == hashlib.sha256(token.encode()).hexdigest()
    assert token not in {key.name, key.prefix, key.token_hash}
    # The list never carries the token again.
    listed = client.get("/api/keys").json()
    assert listed == [{k: v for k, v in body.items() if k != "token"}]
    assert token not in client.get("/api/keys").text


def test_two_keys_get_different_tokens() -> None:
    user = User.objects.create(username="u", email="kari@example.com")
    assert make_key(user, "a")[1] != make_key(user, "b")[1]


@pytest.mark.parametrize(
    ("name", "message"),
    [
        ("", "Gi nøkkelen et navn."),
        ("   ", "Gi nøkkelen et navn."),
        ("x" * 41, "Navnet kan være høyst 40 tegn."),
    ],
)
def test_the_name_is_required_and_at_most_40_characters(
    client: Client, name: str, message: str
) -> None:
    editor(client)
    response = client.post("/api/keys", {"name": name}, content_type=JSON)
    assert response.status_code == 422
    assert response.json() == {"errors": {"name": message}}
    assert client.post("/api/keys", {"name": "x" * 40}, content_type=JSON).status_code == 201


def test_an_editor_sees_and_deletes_only_their_own_keys(client: Client) -> None:
    user = editor(client)
    other = User.objects.create(username="google:o", email="ola@example.com")
    mine, _ = make_key(user, "Samantha")
    theirs, _ = make_key(other, "Ola sin")

    assert [key["name"] for key in client.get("/api/keys").json()] == ["Samantha"]
    assert client.delete(f"/api/keys/{theirs.id}").status_code == 404
    assert client.delete(f"/api/keys/{mine.id}").status_code == 204
    assert client.delete(f"/api/keys/{mine.id}").status_code == 404

    assert client.get("/api/keys").json() == []
    mine.refresh_from_db()
    theirs.refresh_from_db()
    assert mine.deleted_at is not None
    assert theirs.deleted_at is None


def test_keys_are_for_editors_only(client: Client) -> None:
    assert client.get("/api/keys").status_code == 403
    assert client.post("/api/keys", {"name": "x"}, content_type=JSON).status_code == 403
    user = User.objects.create(username="google:g", email="gjest@example.com")
    client.force_login(user)
    assert client.get("/api/keys").status_code == 403
    assert client.post("/api/keys", {"name": "x"}, content_type=JSON).status_code == 403
    assert ApiKey.objects.count() == 0


def test_making_a_key_needs_the_csrf_token() -> None:
    client = Client(enforce_csrf_checks=True)
    editor(client)
    response = client.post("/api/keys", {"name": "x"}, content_type=JSON)
    assert response.status_code == 403
    assert ApiKey.objects.count() == 0


def test_a_key_opens_writes_only_while_live_and_its_user_an_editor() -> None:
    user = User.objects.create(username="google:k", email="kari@example.com")
    Editor.objects.create(email=user.email)
    key, token = make_key(user, "Samantha")

    found, why = editor_for(token)
    assert found == key
    assert why == ""
    key.refresh_from_db()
    assert key.last_used_at is not None

    assert editor_for(token + "x")[0] is None
    Editor.objects.all().delete()
    assert editor_for(token) == (None, "Kontoen nøkkelen hører til, er ikke lenger redaktør.")
    Editor.objects.create(email=user.email)
    key.deleted_at = key.created_at
    key.save()
    found, why = editor_for(token)
    assert found is None
    assert "slettet" in why
