"""Ingredient groups and method phases (ST-1962): the API, the MCP tools, the migration, and
the fallback when the groups no longer match the flat text."""

from collections.abc import Mapping
from importlib import import_module
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from django.apps import apps
from django.contrib.auth.models import User
from django.db import connection
from django.test import Client
from pytest_django import Settings

from food import services, structure
from food.models import Editor, McpChange, Recipe
from tests.test_mcp import call, editor_token, ok, refused

if TYPE_CHECKING:
    from django.test.client import _MonkeyPatchedWSGIResponse as Response

pytestmark = pytest.mark.django_db

JSON = "application/json"

# Asiatisk tynnribbe (ST-1966), shortened: two groups, two phases.
GROUPS: list[structure.Group] = [
    {"title": "Rub", "ingredients": "2 ss brunt sukker\n1 ss five spice"},
    {"title": "Glaze", "ingredients": "4 ss hoisinsaus\n2 ss soyasaus"},
]
PHASES: list[structure.Phase] = [
    {
        "title": "Rub",
        "time": "Gjerne dagen før",
        "instructions": "Bland alt i ruben.\n\nGni ruben godt inn.",
    },
    {"title": "Glaze", "time": "", "instructions": "Bland alt i glazen."},
]


@pytest.fixture(autouse=True)
def site(settings: Settings, tmp_path: Path) -> None:
    settings.FOOD_SITE_URL = "https://food.st44.no"
    (tmp_path / "index.html").write_text("<app-root></app-root>", encoding="utf-8")
    settings.SPA_DIR = tmp_path


@pytest.fixture
def editor(client: Client) -> Client:
    user = User.objects.create(username="google:editor", email="editor@example.com")
    Editor.objects.create(email=user.email)
    client.force_login(user)
    return client


def post(client: Client, body: Mapping[str, object]) -> "Response":
    return client.post("/api/recipes", body, content_type=JSON)


# --- the API ---


def test_groups_and_phases_are_saved_with_the_flat_text(editor: Client) -> None:
    response = post(editor, {"title": "Tynnribbe", "ingredient_groups": GROUPS, "phases": PHASES})

    assert response.status_code == 201
    body = response.json()
    assert body["ingredient_groups"] == GROUPS
    assert body["phases"] == PHASES
    # Every line of every group, in order: the shopping list reads this (Google Keep flow).
    assert body["ingredients"] == (
        "2 ss brunt sukker\n1 ss five spice\n4 ss hoisinsaus\n2 ss soyasaus"
    )
    assert body["instructions"] == (
        "Bland alt i ruben.\n\nGni ruben godt inn.\n\nBland alt i glazen."
    )
    assert editor.get(f"/api/recipes/{body['id']}").json() == body


def test_a_plain_recipe_is_one_untitled_group_and_no_phases(editor: Client) -> None:
    body = post(editor, {"title": "Fårikål", "ingredients": "lam\nkål", "instructions": "Kok."})

    assert body.json()["ingredient_groups"] == [{"title": "", "ingredients": "lam\nkål"}]
    assert body.json()["phases"] == []


def test_one_titled_group_is_allowed(editor: Client) -> None:
    group = [{"title": "Deig", "ingredients": "mel"}]
    response = post(editor, {"title": "Brød", "ingredient_groups": group})

    assert response.status_code == 201
    assert response.json()["ingredient_groups"] == group


def test_every_rule_is_answered_at_once(editor: Client) -> None:
    response = post(
        editor,
        {
            "title": " ",
            "ingredient_groups": [
                {"title": "Rub", "ingredients": "salt"},
                {"title": " ", "ingredients": "soyasaus"},
                {"title": "Topping", "ingredients": ""},
            ],
            "phases": [
                {"title": "Rub", "instructions": "Gni inn."},
                {"title": "Røyk", "time": "3 timer", "instructions": "  "},
                {"title": "", "instructions": "Server."},
            ],
        },
    )

    assert response.status_code == 422
    assert response.json() == {
        "errors": {
            "title": "Tittelen må fylles ut.",
            "ingredient_groups.1.title": structure.GROUP_TITLE,
            "ingredient_groups.2.ingredients": structure.GROUP_EMPTY,
            "phases.1.instructions": structure.PHASE_EMPTY,
            "phases.2.title": structure.PHASE_TITLE,
        }
    }
    assert not Recipe.objects.exists()


def test_no_ingredients_at_all_is_the_old_message(editor: Client) -> None:
    for body in (
        {"title": "x", "ingredients": " "},
        {"title": "x", "ingredient_groups": []},
    ):
        assert post(editor, body).json() == {
            "errors": {"ingredients": "Skriv inn minst én ingrediens."}
        }


def test_an_edit_back_to_one_list_drops_the_groups_and_phases(editor: Client) -> None:
    made = post(editor, {"title": "Ribbe", "ingredient_groups": GROUPS, "phases": PHASES}).json()

    response = editor.put(
        f"/api/recipes/{made['id']}",
        {"title": "Ribbe", "ingredients": made["ingredients"], "instructions": "Grill."},
        content_type=JSON,
    )

    assert response.json()["ingredient_groups"] == [
        {"title": "", "ingredients": made["ingredients"]}
    ]
    assert response.json()["phases"] == []


# --- a rollback, and the migration ---


def test_groups_that_no_longer_match_the_text_are_ignored() -> None:
    recipe = services.create_recipe(
        title="Ribbe", ingredients="", instructions="", ingredient_groups=GROUPS, phases=PHASES
    )
    # Code from before ST-1962 edits only the flat fields.
    Recipe.objects.filter(pk=recipe.pk).update(ingredients="salt", instructions="Stek.")
    recipe.refresh_from_db()

    assert structure.groups_of(recipe) == [{"title": "", "ingredients": "salt"}]
    assert structure.phases_of(recipe) == []


def test_a_recipe_added_by_old_code_reads_as_plain() -> None:
    # The column's db_default, when an insert does not name it.
    with connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO food_recipe (title, ingredients, instructions, created_at, photo, "
            "description) VALUES ('Sveler', 'mel', '', '2026-10-31', '', '')"
        )
    recipe = Recipe.objects.get(title="Sveler")

    assert recipe.ingredient_groups == []
    assert structure.groups_of(recipe) == [{"title": "", "ingredients": "mel"}]
    assert structure.phases_of(recipe) == []


def test_the_migration_makes_every_recipe_one_untitled_group() -> None:
    Recipe.objects.create(title="Fårikål", ingredients="lam\nkål", instructions="Kok.")
    Recipe.objects.create(title="Sveler", ingredients="mel", instructions="")
    Recipe.objects.update(ingredient_groups=[], phases=[])
    migration = import_module("food.migrations.0011_recipe_groups_phases")

    migration.one_plain_group(apps, None)

    assert {r.title: (r.ingredient_groups, r.phases) for r in Recipe.objects.all()} == {
        "Fårikål": ([{"title": "", "ingredients": "lam\nkål"}], []),
        "Sveler": ([{"title": "", "ingredients": "mel"}], []),
    }


# --- the MCP tools ---


def test_mcp_writes_and_reads_groups_and_phases(client: Client) -> None:
    token = editor_token()

    made = ok(
        call(
            client,
            "create_recipe",
            token,
            title="Tynnribbe",
            ingredient_groups=GROUPS,
            phases=PHASES,
        )
    )

    assert made["ingredient_groups"] == GROUPS
    assert made["phases"] == PHASES
    assert made["ingredients"].splitlines() == [
        "2 ss brunt sukker",
        "1 ss five spice",
        "4 ss hoisinsaus",
        "2 ss soyasaus",
    ]
    assert ok(call(client, "get_recipe", id=made["id"])) == made


def test_mcp_keeps_the_old_flat_write(client: Client) -> None:
    token = editor_token()

    made = ok(call(client, "create_recipe", token, title="Taco", ingredients="lefser\nost"))

    assert made["ingredient_groups"] == [{"title": "", "ingredients": "lefser\nost"}]
    assert made["phases"] == []


def test_mcp_update_regroups_and_flattens(client: Client) -> None:
    token = editor_token()
    made = ok(call(client, "create_recipe", token, title="Ribbe", ingredients="salt"))

    grouped = ok(call(client, "update_recipe", token, id=made["id"], ingredient_groups=GROUPS))
    assert grouped["ingredient_groups"] == GROUPS
    assert grouped["changed"] == ["ingredients"]

    renamed = ok(call(client, "update_recipe", token, id=made["id"], title="Tynnribbe"))
    assert renamed["ingredient_groups"] == GROUPS, "an update of the title keeps the groups"

    phased = ok(call(client, "update_recipe", token, id=made["id"], phases=PHASES))
    assert phased["phases"] == PHASES
    assert phased["changed"] == ["instructions"]

    flat = ok(call(client, "update_recipe", token, id=made["id"], ingredients="salt\npepper"))
    assert flat["ingredient_groups"] == [{"title": "", "ingredients": "salt\npepper"}]
    assert flat["phases"] == PHASES

    summaries = list(McpChange.objects.order_by("id").values_list("summary", flat=True))
    assert summaries[1:] == [
        "endret: ingredienser",
        "endret: tittel",
        "endret: fremgangsmåte",
        "endret: ingredienser",
    ]


def test_mcp_keeps_the_rules(client: Client) -> None:
    token = editor_token()
    groups = [{"title": "Rub", "ingredients": "salt"}, {"ingredients": "soyasaus"}]

    message = refused(call(client, "create_recipe", token, title="Ribbe", ingredient_groups=groups))

    assert message == f"ingredient_groups.1.title: {structure.GROUP_TITLE}"
