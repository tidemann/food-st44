from datetime import UTC, datetime, timedelta

import pytest
from django.contrib.auth.models import User
from django.test import Client

from food.api import api
from food.models import Editor, Recipe

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)
JSON = "application/json"


@pytest.fixture(autouse=True)
def _signed_in_editor(client: Client) -> None:
    """Writes need an editor; who gets 403 is tests/test_auth.py. These tests are about the
    recipes themselves, so every request here comes from a signed-in editor."""
    user = User.objects.create(username="google:editor", email="editor@example.com")
    Editor.objects.create(email=user.email)
    client.force_login(user)


def make(title: str, *, days_ago: int = 0, ingredients: str = "x") -> Recipe:
    return Recipe.objects.create(
        title=title, ingredients=ingredients, created_at=NOW - timedelta(days=days_ago)
    )


def titles(client: Client, query: str = "") -> list[str]:
    response = client.get("/api/recipes", {"q": query} if query else {})
    assert response.status_code == 200
    return [recipe["title"] for recipe in response.json()]


# --- list ---


def test_list_is_empty_without_recipes(client: Client) -> None:
    assert titles(client) == []


def test_list_is_newest_first_with_every_field(client: Client) -> None:
    make("Lapskaus", days_ago=2)
    newest = Recipe.objects.create(
        title="Sveler", ingredients="mel\nmelk", instructions="Stek.", created_at=NOW
    )

    response = client.get("/api/recipes")

    assert response.json()[0] == {
        "id": newest.id,
        "title": "Sveler",
        "ingredients": "mel\nmelk",
        "instructions": "Stek.",
        "created_at": "2026-10-04T12:00:00Z",
        "photo_url": None,
        "tags": [],
    }
    assert titles(client) == ["Sveler", "Lapskaus"]


def test_search_is_a_case_insensitive_substring_of_the_title(client: Client) -> None:
    make("Kjøttkaker i brun saus", days_ago=2)
    make("Fårikål", days_ago=1)
    make("Kjøttsuppe")

    assert titles(client, "KJØTT") == ["Kjøttsuppe", "Kjøttkaker i brun saus"]
    assert titles(client, "brun saus") == ["Kjøttkaker i brun saus"]
    assert titles(client, "  kål  ") == ["Fårikål"]


def test_search_does_not_look_at_ingredients_or_fold_accents(client: Client) -> None:
    make("Fårikål", ingredients="kål\nfår")

    assert titles(client, "får") == ["Fårikål"]
    assert titles(client, "kal") == []
    make("Pinnekjøtt", ingredients="kålrot")
    assert titles(client, "kålrot") == []


def test_blank_search_lists_everything(client: Client) -> None:
    make("Sveler")

    assert titles(client, "   ") == ["Sveler"]


# --- get ---


def test_get_returns_the_recipe(client: Client) -> None:
    recipe = make("Raspeballer")

    response = client.get(f"/api/recipes/{recipe.id}")

    assert response.status_code == 200
    assert response.json()["title"] == "Raspeballer"


def test_get_missing_recipe_is_404(client: Client) -> None:
    response = client.get("/api/recipes/999")

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


# --- create ---


def test_create_stores_trimmed_values_and_returns_201(client: Client) -> None:
    response = client.post(
        "/api/recipes",
        {"title": "  Sveler ", "ingredients": "\n mel\nmelk \n", "instructions": "  Stek. "},
        content_type=JSON,
    )

    assert response.status_code == 201
    body = response.json()
    recipe = Recipe.objects.get(pk=body["id"])
    assert (recipe.title, recipe.ingredients, recipe.instructions) == (
        "Sveler",
        "mel\nmelk",
        "Stek.",
    )
    assert body["title"] == "Sveler"


def test_create_without_instructions(client: Client) -> None:
    response = client.post(
        "/api/recipes", {"title": "Brød", "ingredients": "mel"}, content_type=JSON
    )

    assert response.status_code == 201
    assert response.json()["instructions"] == ""


def test_create_rejects_blank_title_and_ingredients_per_field(client: Client) -> None:
    response = client.post(
        "/api/recipes",
        {"title": "   ", "ingredients": "\n", "instructions": "Kok."},
        content_type=JSON,
    )

    assert response.status_code == 422
    assert response.json() == {
        "errors": {
            "title": "Tittelen må fylles ut.",
            "ingredients": "Skriv inn minst én ingrediens.",
        }
    }
    assert not Recipe.objects.exists()


def test_create_rejects_a_missing_field(client: Client) -> None:
    response = client.post("/api/recipes", {"ingredients": "mel"}, content_type=JSON)

    assert response.status_code == 422
    assert set(response.json()["errors"]) == {"title"}


def test_create_ignores_id_and_created_at_from_the_client(client: Client) -> None:
    response = client.post(
        "/api/recipes",
        {"title": "T", "ingredients": "x", "id": 77, "created_at": "2000-01-01T00:00:00Z"},
        content_type=JSON,
    )

    recipe = Recipe.objects.get(pk=response.json()["id"])
    assert recipe.id != 77
    assert recipe.created_at.year != 2000


# --- update ---


def test_update_replaces_the_text_and_keeps_created_at(client: Client) -> None:
    recipe = make("Lapskaus", days_ago=3)

    response = client.put(
        f"/api/recipes/{recipe.id}",
        {"title": " Lapskaus med pølse ", "ingredients": "kjøtt\npølse", "instructions": ""},
        content_type=JSON,
    )

    assert response.status_code == 200
    recipe.refresh_from_db()
    assert recipe.title == "Lapskaus med pølse"
    assert recipe.ingredients == "kjøtt\npølse"
    assert recipe.created_at == NOW - timedelta(days=3)
    assert response.json()["created_at"] == "2026-10-01T12:00:00Z"


def test_update_validates_like_create(client: Client) -> None:
    recipe = make("Lapskaus")

    response = client.put(
        f"/api/recipes/{recipe.id}", {"title": "", "ingredients": "x"}, content_type=JSON
    )

    assert response.status_code == 422
    assert response.json() == {"errors": {"title": "Tittelen må fylles ut."}}
    recipe.refresh_from_db()
    assert recipe.title == "Lapskaus"


def test_update_missing_recipe_is_404(client: Client) -> None:
    response = client.put("/api/recipes/999", {"title": "T", "ingredients": "x"}, content_type=JSON)

    assert response.status_code == 404


# --- delete ---


def test_delete_removes_the_recipe(client: Client) -> None:
    recipe = make("Rømmegrøt")

    response = client.delete(f"/api/recipes/{recipe.id}")

    assert response.status_code == 204
    assert response.content == b""
    assert not Recipe.objects.exists()


def test_delete_missing_recipe_is_404(client: Client) -> None:
    assert client.delete("/api/recipes/999").status_code == 404


# --- contract ---


def test_non_numeric_id_is_rejected(client: Client) -> None:
    assert client.get("/api/recipes/3abc").status_code == 422


def test_every_response_code_is_in_the_schema() -> None:
    paths = api.get_openapi_schema()["paths"]

    assert set(paths["/api/recipes"]["get"]["responses"]) == {200}
    assert set(paths["/api/recipes"]["post"]["responses"]) == {201, 403, 422}
    assert set(paths["/api/recipes/{recipe_id}"]["get"]["responses"]) == {200, 404}
    assert set(paths["/api/recipes/{recipe_id}"]["put"]["responses"]) == {200, 403, 404, 422}
    assert set(paths["/api/recipes/{recipe_id}"]["delete"]["responses"]) == {204, 403, 404}
    assert set(paths["/api/tags"]["get"]["responses"]) == {200}
