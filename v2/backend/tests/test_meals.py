import json
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest
from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.test import Client
from pytest_django import Settings

from food import meals, plan, services
from food.keys import make_key
from food.models import Editor, McpChange, Meal, PlannedDinner, Recipe

if TYPE_CHECKING:
    from django.test.client import _MonkeyPatchedWSGIResponse as Response

pytestmark = pytest.mark.django_db

JSON = "application/json"
MCP = "/api/mcp"
# Thursday of ISO week 2026-W43.
TODAY = date(2026, 10, 22)
TORO_ITEMS = (
    "2 pk naan\n1 beger crème fraîche\nsolsikkeolje\n1 pk papadums\n600 g kylling\n"
    "mango chutney\n1 beger raita"
)


@pytest.fixture(autouse=True)
def site(settings: Settings, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    settings.FOOD_SITE_URL = "https://food.st44.no"
    settings.FOOD_ADMIN_EMAILS = ["stig@example.com"]
    (tmp_path / "index.html").write_text("<app-root></app-root>", encoding="utf-8")
    settings.SPA_DIR = tmp_path
    monkeypatch.setattr(plan, "today", lambda: TODAY)


def editor(email: str = "maria@example.com", name: str = "Maria") -> User:
    user = User.objects.create(username=f"google:{email}", email=email, first_name=name)
    Editor.objects.create(email=email)
    return user


@pytest.fixture
def maria(client: Client) -> User:
    user = editor()
    client.force_login(user)
    return user


@pytest.fixture
def toro() -> Meal:
    return meals.create_meal(
        title="Toro Tandoori chicken", items=TORO_ITEMS, note="Toro-posen tar 25 minutter."
    )


@pytest.fixture
def lapskaus() -> Recipe:
    return services.create_recipe(
        title="Lapskaus", ingredients="kjøtt\npotet", instructions="Kok.", servings=6
    )


def send(client: Client, method: str, path: str, **body: object) -> "Response":
    sender = client.put if method == "put" else client.post
    return sender(path, json.dumps(body), content_type=JSON)


# --- the model's rules ---


@pytest.mark.parametrize(
    "fields",
    [
        {"meal_title": "Toro", "recipe_title": "Lapskaus"},  # a meal and a recipe
        {"meal_title": "Toro", "text": "Rester"},  # a meal and a text
        {"meal_title": "Toro", "portions": 4},  # a meal has no portions
    ],
)
def test_a_dinner_is_one_of_recipe_meal_or_text(fields: dict[str, object]) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        PlannedDinner.objects.create(date=TODAY, **fields)


def test_a_meal_day_is_allowed(toro: Meal) -> None:
    PlannedDinner.objects.create(date=TODAY, meal=toro, meal_title=toro.title)
    assert plan.get_day(TODAY)["kind"] == "meal"


# --- /api/meals ---


def test_reading_meals_is_public(client: Client, toro: Meal) -> None:
    big_one = meals.create_meal(title="Big One frozen pizza", items="2 stk Big One pepperoni")

    listed = client.get("/api/meals").json()
    assert [meal["title"] for meal in listed] == [big_one.title, toro.title]
    one = client.get(f"/api/meals/{toro.id}").json()
    assert (one["items"], one["item_count"], one["note"]) == (
        TORO_ITEMS,
        7,
        "Toro-posen tar 25 minutter.",
    )
    assert client.get("/api/meals/999").status_code == 404


def test_an_editor_creates_edits_and_deletes(client: Client, maria: User) -> None:
    made = send(
        client, "post", "/api/meals", title=" Taco ", items="1 pk lomper\n\n  kjøttdeig  \n"
    )
    assert made.status_code == 201
    meal = made.json()
    assert (meal["title"], meal["items"], meal["item_count"], meal["note"]) == (
        "Taco",
        "1 pk lomper\nkjøttdeig",
        2,
        "",
    )

    edited = send(
        client, "put", f"/api/meals/{meal['id']}", title="Fredagstaco", items="lomper", note="Ok."
    )
    assert edited.status_code == 200
    assert (edited.json()["title"], edited.json()["created_at"]) == (
        "Fredagstaco",
        meal["created_at"],
    )

    assert client.delete(f"/api/meals/{meal['id']}").status_code == 204
    assert not Meal.objects.exists()


@pytest.mark.parametrize(
    ("body", "errors"),
    [
        (
            {"title": " ", "items": "\n \n"},
            {"title": "Tittelen må fylles ut.", "items": "Skriv inn minst én vare."},
        ),
        (
            {"title": "Taco", "items": "lomper", "note": "x" * 301},
            {"note": "Notatet kan være høyst 300 tegn."},
        ),
    ],
)
def test_the_rules_for_a_meal(
    client: Client, maria: User, body: dict[str, object], errors: dict[str, str]
) -> None:
    response = send(client, "post", "/api/meals", **body)

    assert response.status_code == 422
    assert response.json() == {"errors": errors}
    assert not Meal.objects.exists()


def test_writes_need_an_editor(client: Client, toro: Meal) -> None:
    body = {"title": "Taco", "items": "lomper"}
    assert send(client, "post", "/api/meals", **body).status_code == 403
    client.force_login(User.objects.create(username="google:x", email="x@example.com"))
    assert send(client, "post", "/api/meals", **body).status_code == 403
    assert send(client, "put", f"/api/meals/{toro.id}", **body).status_code == 403
    assert client.delete(f"/api/meals/{toro.id}").status_code == 403
    assert client.get(f"/api/meals/{toro.id}/days").status_code == 403
    assert list(Meal.objects.values_list("title", flat=True)) == [toro.title]


def test_meal_pages_are_the_spa(client: Client, toro: Meal) -> None:
    for path in (
        "/maltider",
        "/maltider/ny/",
        f"/maltider/{toro.id}",
        f"/maltider/{toro.id}/slett",
    ):
        response = client.get(path)
        assert response.status_code == 200
        assert b"<app-root>" in response.content
    for path in ("/maltider/999", "/maltider/999/rediger", "/maltider/x/y"):
        assert client.get(path).status_code == 404


# --- meals on the week plan ---


def test_a_meal_on_the_plan_has_no_portions(client: Client, maria: User, toro: Meal) -> None:
    day = send(client, "put", "/api/plan/2026-10-23", meal_id=toro.id).json()

    assert (day["kind"], day["meal_id"], day["recipe_id"], day["title"]) == (
        "meal",
        toro.id,
        None,
        "Toro Tandoori chicken",
    )
    assert (day["portions"], day["item_count"], day["meal_deleted"]) == (None, 7, False)
    week = client.get("/api/plan").json()
    assert week["days"][4]["kind"] == "meal"


@pytest.mark.parametrize(
    ("body", "field", "message"),
    [
        ({"meal_id": 999}, "meal_id", "Fant ikke noe måltid med id 999."),
        ({"meal_id": "toro", "portions": 4}, "portions", plan.MEAL_PORTIONS),
        ({"meal_id": "toro", "recipe_id": 1}, "meal_id", plan.RECIPE_OR_TEXT),
        ({"meal_id": "toro", "text": "Rester"}, "text", plan.RECIPE_OR_TEXT),
    ],
)
def test_the_plan_refuses_a_meal_with_something_else(
    client: Client, maria: User, toro: Meal, body: dict[str, object], field: str, message: str
) -> None:
    if body["meal_id"] == "toro":
        body = {**body, "meal_id": toro.id}
    response = send(client, "put", "/api/plan/2026-10-23", **body)

    assert response.status_code == 422
    assert response.json() == {"errors": {field: message}}
    assert not PlannedDinner.objects.exists()


def test_a_meal_replaces_a_recipe_and_back(
    client: Client, maria: User, toro: Meal, lapskaus: Recipe
) -> None:
    send(client, "put", "/api/plan/2026-10-23", recipe_id=lapskaus.id)
    assert send(client, "put", "/api/plan/2026-10-23", meal_id=toro.id).json()["kind"] == "meal"
    day = send(client, "put", "/api/plan/2026-10-23", recipe_id=lapskaus.id).json()
    assert (day["kind"], day["meal_id"], day["portions"]) == ("recipe", None, 6)


def test_a_meal_and_a_recipe_swap_days(
    client: Client, maria: User, toro: Meal, lapskaus: Recipe
) -> None:
    send(client, "put", "/api/plan/2026-10-23", recipe_id=lapskaus.id)
    send(client, "put", "/api/plan/2026-10-24", meal_id=toro.id)

    days = send(client, "post", "/api/plan/2026-10-23/move", to="2026-10-24").json()["days"]
    assert [(day["kind"], day["title"]) for day in days] == [
        ("meal", "Toro Tandoori chicken"),
        ("recipe", "Lapskaus"),
    ]


def test_renaming_and_deleting_a_meal_on_the_plan(maria: User, toro: Meal) -> None:
    plan.set_dinner(TODAY, plan.check(meal_id=toro.id), maria)
    meals.update_meal(toro, title="Toro tandoori", items="naan")
    assert plan.get_day(TODAY)["title"] == "Toro tandoori"

    meals.delete_meal(toro)
    day = plan.get_day(TODAY)
    assert (day["kind"], day["meal_id"], day["title"], day["meal_deleted"]) == (
        "meal",
        None,
        "Toro tandoori",
        True,
    )
    assert day["item_count"] is None


def test_the_days_a_meal_is_planned_from_today(client: Client, maria: User, toro: Meal) -> None:
    for day in (date(2026, 10, 21), TODAY, date(2026, 10, 29)):
        plan.set_dinner(day, plan.check(meal_id=toro.id), maria)

    assert client.get(f"/api/meals/{toro.id}/days").json() == ["2026-10-22", "2026-10-29"]


# --- MCP ---


def rpc(client: Client, method: str, params: dict[str, Any], token: str = "") -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    response = client.post(MCP, json.dumps(body), content_type=JSON, headers=headers)
    assert response.status_code == 200
    result: dict[str, Any] = response.json()["result"]
    return result


def call(client: Client, tool: str, token: str = "", **arguments: object) -> dict[str, Any]:
    return rpc(client, "tools/call", {"name": tool, "arguments": arguments}, token)


def ok(result: dict[str, Any]) -> dict[str, Any]:
    assert result["isError"] is False, result
    structured: dict[str, Any] = result["structuredContent"]
    return structured


@pytest.fixture
def token() -> str:
    return make_key(editor("kari@example.com", "Kari"), "Samantha")[1]


def log() -> list[tuple[str, int | None, int | None, str]]:
    rows = McpChange.objects.order_by("id").values_list("tool", "recipe_id", "meal_id", "summary")
    return list(rows)


def test_anyone_reads_meals(client: Client, toro: Meal) -> None:
    listed = ok(call(client, "list_meals"))
    assert listed == {
        "count": 1,
        "meals": [
            {
                "id": toro.id,
                "title": "Toro Tandoori chicken",
                "item_count": 7,
                "link": f"https://food.st44.no/maltider/{toro.id}",
            }
        ],
    }
    one = ok(call(client, "get_meal", id=toro.id))
    assert (one["items"], one["note"]) == (TORO_ITEMS, "Toro-posen tar 25 minutter.")
    assert call(client, "get_meal", id=999)["isError"] is True


def test_save_meal_adds_and_changes_and_logs(client: Client, token: str) -> None:
    made = ok(call(client, "save_meal", token, title="Big One frozen pizza", items="2 stk Big One"))
    assert (made["title"], made["item_count"], made["note"]) == ("Big One frozen pizza", 1, "")

    same = ok(call(client, "save_meal", token, id=made["id"], title="Big One frozen pizza"))
    assert same["changed"] == []
    changed = ok(call(client, "save_meal", token, id=made["id"], items="2 stk Big One\nruccola"))
    assert (changed["changed"], changed["title"], changed["item_count"]) == (
        ["items"],
        "Big One frozen pizza",
        2,
    )
    assert log() == [
        ("save_meal", None, made["id"], "nytt måltid: Big One frozen pizza"),
        ("save_meal", None, made["id"], "endret: varer"),
    ]


def test_save_meal_keeps_the_rules(client: Client, token: str, toro: Meal) -> None:
    assert call(client, "save_meal", token, title="Taco")["isError"] is True
    blank = call(client, "save_meal", token, id=toro.id, items=" ")
    assert blank["isError"] is True
    assert "Skriv inn minst én vare." in blank["content"][0]["text"]
    refused = call(client, "save_meal", title="Taco", items="lomper")
    assert refused["isError"] is True
    assert Meal.objects.get().items == TORO_ITEMS
    assert not McpChange.objects.exists()


def test_delete_meal_keeps_the_plan_days(
    client: Client, token: str, maria: User, toro: Meal
) -> None:
    plan.set_dinner(TODAY, plan.check(meal_id=toro.id), maria)

    deleted = ok(call(client, "delete_meal", token, id=toro.id))
    assert deleted == {
        "deleted": True,
        "id": toro.id,
        "title": "Toro Tandoori chicken",
        "planned_days_kept": ["2026-10-22"],
    }
    assert plan.get_day(TODAY)["meal_deleted"] is True
    assert log() == [("delete_meal", None, toro.id, "slettet måltid: Toro Tandoori chicken")]
    assert call(client, "delete_meal", token, id=toro.id)["isError"] is True


def test_the_plan_tools_take_a_meal(
    client: Client, token: str, toro: Meal, lapskaus: Recipe
) -> None:
    ok(call(client, "set_dinner", token, date="2026-10-22", meal_id=toro.id))
    ok(call(client, "set_dinner", token, date="2026-10-23", recipe_id=lapskaus.id))
    refused = call(client, "set_dinner", token, date="2026-10-24", meal_id=toro.id, portions=4)
    assert refused["isError"] is True

    week = ok(call(client, "get_meal_plan", token))
    meal_day, recipe_day = week["days"][3], week["days"][4]
    assert meal_day == {
        "date": "2026-10-22",
        "weekday": "torsdag",
        "kind": "meal",
        "recipe_id": None,
        "meal_id": toro.id,
        "title": "Toro Tandoori chicken",
        "text": "",
        "portions": None,
        "servings": None,
        "ingredients": TORO_ITEMS,
        "recipe_deleted": False,
        "meal_deleted": False,
        "link": f"https://food.st44.no/maltider/{toro.id}",
    }
    # The same shape as a recipe day's lines, so one list can merge «kylling» from both.
    assert recipe_day["ingredients"] == "kjøtt\npotet"

    ok(call(client, "clear_dinner", token, date="2026-10-22"))
    assert log() == [
        ("set_dinner", None, toro.id, "2026-10-22: Toro Tandoori chicken (måltid)"),
        ("set_dinner", lapskaus.id, None, "2026-10-23: Lapskaus (6 porsjoner)"),
        ("clear_dinner", None, toro.id, "2026-10-22: fjernet Toro Tandoori chicken"),
    ]
