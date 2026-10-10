from pathlib import Path

import pytest
from django.test import Client
from pytest_django import Settings

from food.models import Recipe
from food.views import parse_id

pytestmark = pytest.mark.django_db

INDEX = """<!doctype html>
<html lang="no">
  <head>
    <title>food.st44.no — familiens oppskrifter</title>
  </head>
  <body><app-root></app-root></body>
</html>
"""


@pytest.fixture(autouse=True)
def spa_dir(settings: Settings, tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text(INDEX, encoding="utf-8")
    settings.SPA_DIR = tmp_path


def title_of(html: str) -> str:
    return html.split("<title>", 1)[1].split("</title>", 1)[0]


@pytest.fixture
def recipe() -> Recipe:
    return Recipe.objects.create(title="Kjøttkaker i brun saus & <potet>", ingredients="x")


@pytest.mark.parametrize(
    "path",
    [
        "/",
        "/?q=",
        "/?q=k%C3%A5l",
        # ST-784: the tag filter, alone and with a search.
        "/?tag=middag",
        "/?tag=middag&q=kylling",
        "/?tag=h%C3%B8st",
        "/recipes/new",
        "/recipes/new/",
        # M4 and M5: "new" is not a recipe id here either.
        "/recipes/new/photo",
        "/recipes/new/link",
        "/recipes/new/text/",
    ],
)
def test_fixed_client_routes_are_200_with_the_default_title(client: Client, path: str) -> None:
    response = client.get(path)

    assert response.status_code == 200
    assert response["Content-Type"] == "text/html; charset=utf-8"
    assert "<app-root>" in response.text
    assert title_of(response.text) == "food.st44.no — familiens oppskrifter"


@pytest.mark.parametrize(
    "path", ["/nope", "/nonsens/bla", "/recipes", "/recipes/1/edit/more", "/recipes/1/cook/more"]
)
def test_an_unknown_path_is_the_spa_with_404(client: Client, path: str) -> None:
    Recipe.objects.create(pk=1, title="Sveler", ingredients="x")

    response = client.get(path)

    assert response.status_code == 404
    assert "<app-root>" in response.text
    assert title_of(response.text) == "Siden finnes ikke — food.st44.no"


@pytest.mark.parametrize("suffix", ["", "/", "/edit", "/delete", "/cook"])
@pytest.mark.parametrize("raw_id", ["99999", "0", "-1", "abc", "99999999999999999999"])
def test_a_missing_recipe_is_the_spa_with_404(client: Client, raw_id: str, suffix: str) -> None:
    response = client.get(f"/recipes/{raw_id}{suffix}")

    assert response.status_code == 404
    assert "<app-root>" in response.text
    assert title_of(response.text) == "Fant ikke oppskriften — food.st44.no"


@pytest.mark.parametrize("suffix", ["/edit", "/delete"])
def test_new_is_not_a_recipe_id(client: Client, suffix: str) -> None:
    assert client.get(f"/recipes/new{suffix}").status_code == 404


def test_a_recipe_page_carries_the_recipe_title(client: Client, recipe: Recipe) -> None:
    response = client.get(f"/recipes/{recipe.pk}")

    assert response.status_code == 200
    assert "<app-root>" in response.text
    # v1's link preview is the <title> alone: no description, og:* or twitter:* tags.
    assert title_of(response.text) == "Kjøttkaker i brun saus &amp; &lt;potet&gt; — food.st44.no"
    assert "og:" not in response.text
    assert 'name="description"' not in response.text


@pytest.mark.parametrize("suffix", ["/edit", "/delete", "/cook", "/cook/"])
def test_edit_delete_and_cook_of_a_real_recipe_are_200(
    client: Client, recipe: Recipe, suffix: str
) -> None:
    response = client.get(f"/recipes/{recipe.pk}{suffix}")

    assert response.status_code == 200
    assert "<app-root>" in response.text


@pytest.mark.parametrize("suffix", ["/cook", "/cook/", "/cook?steg=1"])
def test_cooking_mode_carries_the_recipe_title(client: Client, recipe: Recipe, suffix: str) -> None:
    response = client.get(f"/recipes/{recipe.pk}{suffix}")

    assert response.status_code == 200
    # The title recipe-cook.ts sets once the recipe has loaded.
    assert title_of(response.text) == (
        "Matlaging: Kjøttkaker i brun saus &amp; &lt;potet&gt; — food.st44.no"
    )


def test_the_id_is_parsed_leniently_like_v1(client: Client, recipe: Recipe) -> None:
    for raw_id in (f"{recipe.pk}abc", f"+{recipe.pk}", f"%20{recipe.pk}"):
        assert client.get(f"/recipes/{raw_id}").status_code == 200, raw_id


@pytest.mark.parametrize(
    ("raw_id", "expected"),
    [("3", 3), ("3abc", 3), ("+3", 3), (" 3", 3), ("0", None), ("-1", None), ("abc", None)],
)
def test_parse_id_matches_javascript_parseint(raw_id: str, expected: int | None) -> None:
    assert parse_id(raw_id) == expected


def test_healthz_and_api_are_unchanged(client: Client) -> None:
    assert client.get("/healthz").content == b"ok"
    assert client.get("/api/recipes/99999").status_code == 404
    assert client.get("/api/recipes/99999")["Content-Type"] == "application/json; charset=utf-8"


def test_a_tagged_recipe_page_is_200(client: Client, recipe: Recipe) -> None:
    """ST-784: a recipe page reached from the tag filter carries `?tag=` and still answers 200."""
    for path in (f"/recipes/{recipe.pk}", f"/recipes/{recipe.pk}?tag=middag"):
        assert client.get(path).status_code == 200, path
