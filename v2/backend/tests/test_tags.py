"""Tags ("emneord", ST-784): the normalising rule, the model, the filter, /api/tags, orphan
removal and who may change them."""

from typing import Any

import pytest
from django.contrib.auth.models import User
from django.db import IntegrityError
from django.test import Client

from food import services
from food.models import Editor, Recipe, Tag
from food.tags import MAX_CHARS, normalise, normalise_one, sort_names

JSON = "application/json"


# --- normalising: one pure function ---


def test_normalise_trims_collapses_and_lowers() -> None:
    assert normalise(["Middag ", "  Rask   MIDDAG\t", "kake"]) == ["middag", "rask middag", "kake"]


def test_normalise_drops_empty_and_duplicate_tags_keeping_the_first() -> None:
    assert normalise(["", "   ", "Middag", "middag", "MIDDAG ", "fisk", "Fisk"]) == [
        "middag",
        "fisk",
    ]


def test_normalise_caps_the_length() -> None:
    long = "a" * 30
    assert normalise([long]) == ["a" * MAX_CHARS]
    # A cut that lands on a space does not leave it trailing.
    assert normalise_one("x" * (MAX_CHARS - 1) + " yyy") == "x" * (MAX_CHARS - 1)
    assert MAX_CHARS == 24


def test_normalise_keeps_norwegian_letters() -> None:
    assert normalise(["Kjøtt", "ÅRSTID", "Smørbrød"]) == ["kjøtt", "årstid", "smørbrød"]


def test_tags_sort_in_norwegian_order() -> None:
    names = ["ål", "øl", "æble", "zucchini", "barnebursdag", "épler", "aprikos"]
    assert sort_names(names) == [
        "aprikos",
        "barnebursdag",
        "épler",
        "zucchini",
        "æble",
        "øl",
        "ål",
    ]


# --- the model ---


@pytest.mark.django_db
def test_a_tag_name_is_unique() -> None:
    Tag.objects.create(name="middag")
    with pytest.raises(IntegrityError):
        Tag.objects.create(name="middag")


@pytest.mark.django_db
def test_recipes_and_tags_are_many_to_many() -> None:
    middag, fisk = Tag.objects.create(name="middag"), Tag.objects.create(name="fisk")
    grateng = Recipe.objects.create(title="Fiskegrateng", ingredients="x")
    lapskaus = Recipe.objects.create(title="Lapskaus", ingredients="x")
    grateng.tags.set([middag, fisk])
    lapskaus.tags.set([middag])

    assert set(middag.recipes.all()) == {grateng, lapskaus}
    assert str(fisk) == "fisk"


# --- the API ---


@pytest.fixture
def editor(client: Client) -> Client:
    user = User.objects.create(username="google:editor", email="editor@example.com")
    Editor.objects.create(email=user.email)
    client.force_login(user)
    return client


def make(title: str, *tags: str) -> Recipe:
    return services.create_recipe(title=title, ingredients="x", instructions="", tags=list(tags))


def titles(client: Client, **params: str) -> list[str]:
    response = client.get("/api/recipes", params)
    assert response.status_code == 200
    return [recipe["title"] for recipe in response.json()]


def tag_list(client: Client) -> list[dict[str, Any]]:
    response = client.get("/api/tags")
    assert response.status_code == 200
    result: list[dict[str, Any]] = response.json()
    return result


@pytest.mark.django_db
def test_create_and_edit_set_normalised_sorted_tags(editor: Client) -> None:
    body = {"title": "Fårikål", "ingredients": "får\nkål", "tags": ["Middag ", "Høst", "middag"]}
    created = editor.post("/api/recipes", body, content_type=JSON)

    assert created.status_code == 201
    assert created.json()["tags"] == ["høst", "middag"]

    recipe_id = created.json()["id"]
    body["tags"] = ["Kjøtt", "Høst"]
    updated = editor.put(f"/api/recipes/{recipe_id}", body, content_type=JSON)

    assert updated.status_code == 200
    assert updated.json()["tags"] == ["høst", "kjøtt"]
    assert editor.get(f"/api/recipes/{recipe_id}").json()["tags"] == ["høst", "kjøtt"]


@pytest.mark.django_db
def test_tags_are_optional_and_an_edit_without_them_clears_them(editor: Client) -> None:
    recipe = make("Sveler", "kake")
    body = {"title": "Sveler", "ingredients": "mel"}

    assert editor.put(f"/api/recipes/{recipe.id}", body, content_type=JSON).json()["tags"] == []


@pytest.mark.django_db
def test_filter_by_tag_alone(client: Client) -> None:
    make("Fiskegrateng", "middag", "fisk")
    make("Sveler", "kake")
    make("Lapskaus", "middag")

    assert titles(client, tag="middag") == ["Lapskaus", "Fiskegrateng"]
    # The filter normalises like a write does.
    assert titles(client, tag=" Middag ") == ["Lapskaus", "Fiskegrateng"]
    assert titles(client, tag="") == ["Lapskaus", "Sveler", "Fiskegrateng"]


@pytest.mark.django_db
def test_filter_by_tag_and_search_together(client: Client) -> None:
    make("Kyllingfrikassé", "middag", "kylling")
    make("Kyllingsalat", "lunsj", "kylling")
    make("Fiskegrateng", "middag")

    assert titles(client, tag="middag", q="kylling") == ["Kyllingfrikassé"]
    assert titles(client, tag="kylling", q="KYLLING") == ["Kyllingsalat", "Kyllingfrikassé"]
    assert titles(client, tag="lunsj", q="fisk") == []


@pytest.mark.django_db
def test_an_unknown_tag_is_an_empty_list(client: Client) -> None:
    make("Sveler", "kake")

    assert titles(client, tag="finnes-ikke") == []


@pytest.mark.django_db
def test_api_tags_counts_only_tags_in_use_in_norwegian_order(client: Client) -> None:
    make("Fårikål", "middag", "høst", "kjøtt")
    make("Lapskaus", "middag", "kjøtt")
    make("Sveler", "kake")
    make("Ølbrød", "øl", "bakst")
    Tag.objects.create(name="ubrukt")

    assert tag_list(client) == [
        {"name": "bakst", "count": 1},
        {"name": "høst", "count": 1},
        {"name": "kake", "count": 1},
        {"name": "kjøtt", "count": 2},
        {"name": "middag", "count": 2},
        {"name": "øl", "count": 1},
    ]


@pytest.mark.django_db
def test_api_tags_is_public_and_empty_without_tags(client: Client) -> None:
    make("Sveler")

    assert tag_list(client) == []


@pytest.mark.django_db
def test_a_tag_no_recipe_carries_after_an_edit_is_deleted(editor: Client) -> None:
    recipe = make("Sveler", "kake", "bakst")
    make("Bløtkake", "kake")
    body = {"title": "Sveler", "ingredients": "mel", "tags": ["kake"]}

    editor.put(f"/api/recipes/{recipe.id}", body, content_type=JSON)

    assert sorted(Tag.objects.values_list("name", flat=True)) == ["kake"]


@pytest.mark.django_db
def test_a_tag_no_recipe_carries_after_a_delete_is_deleted(editor: Client) -> None:
    sveler = make("Sveler", "kake", "bakst")
    make("Bløtkake", "kake")

    assert editor.delete(f"/api/recipes/{sveler.id}").status_code == 204

    assert sorted(Tag.objects.values_list("name", flat=True)) == ["kake"]
    assert tag_list(editor) == [{"name": "kake", "count": 1}]


@pytest.mark.django_db
@pytest.mark.parametrize("who", ["anonymous", "non-editor"])
def test_only_editors_change_tags(client: Client, who: str) -> None:
    if who == "non-editor":
        user = User.objects.create(username="google:gjest", email="gjest@example.com")
        client.force_login(user)
    recipe = make("Sveler", "kake")
    body = {"title": "Sveler", "ingredients": "mel", "tags": ["middag"]}

    assert client.post("/api/recipes", body, content_type=JSON).status_code == 403
    assert client.put(f"/api/recipes/{recipe.id}", body, content_type=JSON).status_code == 403
    assert client.delete(f"/api/recipes/{recipe.id}").status_code == 403

    assert services.tag_names(recipe) == ["kake"]
    assert list(Tag.objects.values_list("name", flat=True)) == ["kake"]
