import json
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest
from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.test import Client
from pytest_django import Settings

from food import plan, services
from food.keys import make_key
from food.models import Editor, McpChange, PlannedDinner, Recipe

if TYPE_CHECKING:
    from django.test.client import _MonkeyPatchedWSGIResponse as Response

pytestmark = pytest.mark.django_db

JSON = "application/json"
MCP = "/api/mcp"
# Thursday of ISO week 2026-W43.
TODAY = date(2026, 10, 22)


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
def lapskaus() -> Recipe:
    return services.create_recipe(
        title="Lapskaus", ingredients="kjøtt\npotet", instructions="Kok.", servings=6
    )


@pytest.fixture
def taco() -> Recipe:
    return services.create_recipe(title="Taco", ingredients="lefser\nkjøttdeig", instructions="")


def put(client: Client, day: str, **body: object) -> "Response":
    return client.put(f"/api/plan/{day}", json.dumps(body), content_type=JSON)


# --- the model's rules ---


def test_one_dinner_per_day(lapskaus: Recipe) -> None:
    PlannedDinner.objects.create(date=TODAY, text="Rester")
    with pytest.raises(IntegrityError), transaction.atomic():
        PlannedDinner.objects.create(date=TODAY, recipe=lapskaus, recipe_title=lapskaus.title)


@pytest.mark.parametrize(
    "fields",
    [
        {},  # neither
        {"text": "Rester", "recipe_title": "Lapskaus"},  # both
    ],
)
def test_a_dinner_is_a_recipe_or_a_text(fields: dict[str, str]) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        PlannedDinner.objects.create(date=TODAY, **fields)


def test_a_deleted_recipe_leaves_its_title(maria: User, lapskaus: Recipe) -> None:
    plan.set_dinner(TODAY, plan.check(recipe_id=lapskaus.id, text=None, portions=None), maria)
    services.delete_recipe(lapskaus)

    day = plan.get_day(TODAY)
    assert (day["recipe_id"], day["title"], day["recipe_deleted"]) == (None, "Lapskaus", True)


def test_editing_a_recipe_renames_it_on_the_plan(maria: User, lapskaus: Recipe) -> None:
    plan.set_dinner(TODAY, plan.check(recipe_id=lapskaus.id, text=None, portions=None), maria)
    services.update_recipe(
        lapskaus, title="Lapskaus med kålrot", ingredients="kjøtt", instructions=""
    )
    services.delete_recipe(Recipe.objects.get(pk=lapskaus.id))

    assert plan.get_day(TODAY)["title"] == "Lapskaus med kålrot"


# --- reading a week ---


def test_the_week_is_monday_to_sunday_with_every_day(client: Client, maria: User) -> None:
    week = client.get("/api/plan", {"week": "2026-W43"}).json()

    assert (week["week"], week["number"], week["start"], week["end"]) == (
        "2026-W43",
        43,
        "2026-10-19",
        "2026-10-25",
    )
    assert (week["previous"], week["next"], week["today"]) == ("2026-W42", "2026-W44", "2026-10-22")
    assert [day["weekday"] for day in week["days"]] == [
        "mandag",
        "tirsdag",
        "onsdag",
        "torsdag",
        "fredag",
        "lørdag",
        "søndag",
    ]
    assert all(day["title"] == day["text"] == "" for day in week["days"])
    assert week["last_change_by"] == ""


def test_no_week_is_this_week_and_a_date_is_its_week(client: Client, maria: User) -> None:
    assert client.get("/api/plan").json()["week"] == "2026-W43"
    assert client.get("/api/plan", {"week": "2026-10-25"}).json()["week"] == "2026-W43"


def test_a_week_across_the_new_year(client: Client, maria: User) -> None:
    put(client, "2026-12-31", text="Pinnekjøtt")
    put(client, "2027-01-01", text="Rester")

    week = client.get("/api/plan", {"week": "2026-W53"}).json()

    assert (week["start"], week["end"], week["next"]) == ("2026-12-28", "2027-01-03", "2027-W01")
    assert [day["text"] for day in week["days"]][3:5] == ["Pinnekjøtt", "Rester"]
    assert client.get("/api/plan", {"week": "2027-W01"}).json()["previous"] == "2026-W53"


@pytest.mark.parametrize("week", ["2026-W54", "2027-W53", "uke 43", "2026-13-01"])
def test_a_week_that_does_not_exist_is_422(client: Client, maria: User, week: str) -> None:
    response = client.get("/api/plan", {"week": week})
    assert response.status_code == 422
    assert response.json() == {"errors": {"week": plan.BAD_WEEK}}


# --- setting and clearing a day ---


def test_set_a_recipe_takes_its_servings(client: Client, maria: User, lapskaus: Recipe) -> None:
    day = put(client, "2026-10-23", recipe_id=lapskaus.id).json()

    assert day["recipe_id"] == lapskaus.id
    assert (day["title"], day["portions"], day["servings"], day["set_by"]) == (
        "Lapskaus",
        6,
        6,
        "Maria",
    )
    week = client.get("/api/plan").json()
    assert week["days"][4]["title"] == "Lapskaus"
    assert week["last_change_by"] == "Maria"


def test_set_a_recipe_without_servings_has_no_portions(
    client: Client, maria: User, taco: Recipe
) -> None:
    assert put(client, "2026-10-23", recipe_id=taco.id).json()["portions"] is None
    assert put(client, "2026-10-23", recipe_id=taco.id, portions=4).json()["portions"] == 4


def test_set_replaces_what_the_day_had(client: Client, maria: User, lapskaus: Recipe) -> None:
    put(client, "2026-10-23", recipe_id=lapskaus.id)
    day = put(client, "2026-10-23", text="  Ute og spiser ").json()

    assert (day["recipe_id"], day["title"], day["text"], day["portions"]) == (
        None,
        "",
        "Ute og spiser",
        None,
    )
    assert PlannedDinner.objects.count() == 1


@pytest.mark.parametrize(
    ("body", "field", "message"),
    [
        ({}, "text", plan.RECIPE_OR_TEXT),
        ({"recipe_id": 1, "text": "Rester"}, "text", plan.RECIPE_OR_TEXT),
        ({"text": "  "}, "text", plan.NO_TEXT),
        ({"text": "x" * 81}, "text", plan.TEXT_TOO_LONG),
        ({"recipe_id": 999}, "recipe_id", "Fant ingen oppskrift med id 999."),
        (
            {"text": "Pizza", "portions": 0},
            "portions",
            "Porsjoner må være et helt tall fra 1 til 99.",
        ),
        (
            {"text": "Pizza", "portions": 100},
            "portions",
            "Porsjoner må være et helt tall fra 1 til 99.",
        ),
    ],
)
def test_set_refuses_what_the_rules_refuse(
    client: Client, maria: User, body: dict[str, object], field: str, message: str
) -> None:
    response = put(client, "2026-10-23", **body)

    assert response.status_code == 422
    assert response.json() == {"errors": {field: message}}
    assert not PlannedDinner.objects.exists()


def test_clear_a_day(client: Client, maria: User) -> None:
    put(client, "2026-10-23", text="Rester")

    assert client.delete("/api/plan/2026-10-23").status_code == 204
    assert client.delete("/api/plan/2026-10-23").status_code == 204
    assert not PlannedDinner.objects.exists()


# --- moving ---


def move(client: Client, source: str, target: str) -> "Response":
    return client.post(f"/api/plan/{source}/move", {"to": target}, content_type=JSON)


def test_move_to_an_empty_day(client: Client, maria: User, lapskaus: Recipe) -> None:
    put(client, "2026-10-23", recipe_id=lapskaus.id, portions=4)

    days = move(client, "2026-10-23", "2026-10-24").json()["days"]

    assert (days[0]["date"], days[0]["title"]) == ("2026-10-23", "")
    assert (days[1]["date"], days[1]["title"], days[1]["portions"]) == ("2026-10-24", "Lapskaus", 4)


def test_move_to_a_taken_day_swaps(client: Client, maria: User, lapskaus: Recipe) -> None:
    put(client, "2026-10-23", recipe_id=lapskaus.id)
    put(client, "2026-10-24", text="Pizza")

    days = move(client, "2026-10-23", "2026-10-24").json()["days"]

    assert (days[0]["text"], days[0]["recipe_id"]) == ("Pizza", None)
    assert (days[1]["title"], days[1]["recipe_id"], days[1]["portions"]) == (
        "Lapskaus",
        lapskaus.id,
        6,
    )
    assert PlannedDinner.objects.count() == 2


def test_move_an_empty_day_is_422(client: Client, maria: User) -> None:
    response = move(client, "2026-10-23", "2026-10-24")
    assert response.status_code == 422
    assert response.json() == {"errors": {"from": plan.NOTHING_TO_MOVE}}


# --- editors only: the page's API ---


def plan_statuses(client: Client) -> list[int]:
    return [
        client.get("/api/plan").status_code,
        put(client, "2026-10-23", text="Rester").status_code,
        client.delete("/api/plan/2026-10-23").status_code,
        move(client, "2026-10-23", "2026-10-24").status_code,
    ]


def test_anonymous_gets_nothing_from_the_plan_api(client: Client) -> None:
    PlannedDinner.objects.create(date=TODAY, text="Hemmelig")
    assert plan_statuses(client) == [403, 403, 403, 403]
    assert PlannedDinner.objects.get().text == "Hemmelig"


def test_a_non_editor_gets_nothing_from_the_plan_api(client: Client) -> None:
    PlannedDinner.objects.create(date=TODAY, text="Hemmelig")
    client.force_login(User.objects.create(username="google:x", email="x@example.com"))
    assert plan_statuses(client) == [403, 403, 403, 403]
    assert "Hemmelig" not in client.get("/api/plan").content.decode()


def test_plan_writes_check_csrf(maria: User) -> None:
    strict = Client(enforce_csrf_checks=True)
    strict.force_login(maria)
    assert strict.get("/api/plan").status_code == 200
    assert put(strict, "2026-10-23", text="Rester").status_code == 403


# --- the page itself ---


@pytest.mark.parametrize("path", ["/ukeplan", "/ukeplan/", "/ukeplan/2026-10-23"])
def test_the_plan_pages_are_the_spa(client: Client, path: str) -> None:
    response = client.get(path)
    assert response.status_code == 200
    assert b"<app-root>" in response.content


def test_healthz_is_still_ok(client: Client) -> None:
    response = client.get("/healthz")
    assert (response.status_code, response.content) == (200, b"ok")


# --- servings on a recipe ---


def test_a_recipe_has_optional_servings(client: Client, maria: User) -> None:
    body = {"title": "Sveler", "ingredients": "mel", "servings": 4}
    made = client.post("/api/recipes", body, content_type=JSON).json()
    assert made["servings"] == 4

    body = {"title": "Sveler", "ingredients": "mel"}
    changed = client.put(f"/api/recipes/{made['id']}", body, content_type=JSON).json()
    assert changed["servings"] is None

    body = {"title": "Sveler", "ingredients": "mel", "servings": 0}
    response = client.post("/api/recipes", body, content_type=JSON)
    assert response.status_code == 422
    assert response.json() == {
        "errors": {"servings": "Porsjoner må være et helt tall fra 1 til 99."}
    }


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


PLAN_TOOLS = {"get_meal_plan", "set_dinner", "clear_dinner"}


@pytest.fixture
def token() -> str:
    return make_key(editor("kari@example.com", "Kari"), "Samantha")[1]


def tool_names(client: Client, token: str = "") -> set[str]:
    return {tool["name"] for tool in rpc(client, "tools/list", {}, token)["tools"]}


def test_the_plan_tools_are_listed_for_an_editor_only(client: Client, token: str) -> None:
    assert tool_names(client, token) >= PLAN_TOOLS
    assert not PLAN_TOOLS & tool_names(client)
    outsider = User.objects.create(username="google:x", email="x@example.com")
    assert not PLAN_TOOLS & tool_names(client, make_key(outsider, "Min")[1])


@pytest.mark.parametrize("tool", sorted(PLAN_TOOLS))
def test_anonymous_and_non_editors_get_a_clear_error(client: Client, tool: str) -> None:
    PlannedDinner.objects.create(date=TODAY, text="Hemmelig")
    args = {} if tool == "get_meal_plan" else {"date": "2026-10-22", "text": "Pizza"}
    if tool == "clear_dinner":
        args = {"date": "2026-10-22"}
    outsider = User.objects.create(username="google:x", email="x@example.com")

    for key in ("", make_key(outsider, "Min")[1]):
        result = call(client, tool, key, **args)
        assert result["isError"] is True
        assert "redaktør" in result["content"][0]["text"]
        assert "Hemmelig" not in json.dumps(result)
    assert PlannedDinner.objects.get().text == "Hemmelig"
    assert not McpChange.objects.exists()


def test_get_meal_plan_defaults_to_this_week(client: Client, token: str, lapskaus: Recipe) -> None:
    PlannedDinner.objects.create(
        date=TODAY, recipe=lapskaus, recipe_title=lapskaus.title, portions=4
    )
    PlannedDinner.objects.create(date=date(2026, 10, 23), text="Rester")

    week = ok(call(client, "get_meal_plan", token))

    assert (week["start"], week["end"]) == ("2026-10-19", "2026-10-25")
    assert week["link"] == "https://food.st44.no/ukeplan?uke=2026-W43"
    assert len(week["days"]) == 7
    assert week["days"][3] == {
        "date": "2026-10-22",
        "weekday": "torsdag",
        "recipe_id": lapskaus.id,
        "title": "Lapskaus",
        "text": "",
        "portions": 4,
        "servings": 6,
        "recipe_deleted": False,
        "link": f"https://food.st44.no/recipes/{lapskaus.id}",
    }
    assert (week["days"][4]["text"], week["days"][4]["recipe_id"]) == ("Rester", None)
    assert week["days"][0]["title"] == week["days"][0]["text"] == ""


def test_get_meal_plan_from_a_start_for_some_days(client: Client, token: str) -> None:
    week = ok(call(client, "get_meal_plan", token, start="2026-12-30", days=4))
    assert [day["date"] for day in week["days"]] == [
        "2026-12-30",
        "2026-12-31",
        "2027-01-01",
        "2027-01-02",
    ]
    assert call(client, "get_meal_plan", token, days=40)["isError"] is True


def test_set_dinner_and_the_change_log(client: Client, token: str, lapskaus: Recipe) -> None:
    day = ok(call(client, "set_dinner", token, date="2026-10-23", recipe_id=lapskaus.id))
    assert (day["title"], day["portions"], day["weekday"]) == ("Lapskaus", 6, "fredag")

    ok(call(client, "set_dinner", token, date="2026-10-24", text="Taco"))

    dinner = PlannedDinner.objects.get(date=date(2026, 10, 23))
    assert dinner.set_by is not None
    assert dinner.set_by.email == "kari@example.com"
    log = list(McpChange.objects.order_by("id").values_list("tool", "via", "recipe_id", "summary"))
    assert log == [
        ("set_dinner", "Samantha", lapskaus.id, "2026-10-23: Lapskaus (6 porsjoner)"),
        ("set_dinner", "Samantha", None, "2026-10-24: Taco"),
    ]
    assert all(
        change.user and change.user.email == "kari@example.com"
        for change in McpChange.objects.all()
    )


def test_set_dinner_keeps_the_rules(client: Client, token: str) -> None:
    result = call(client, "set_dinner", token, date="2026-10-23", recipe_id=1, text="Taco")
    assert result["isError"] is True
    assert plan.RECIPE_OR_TEXT in result["content"][0]["text"]
    assert call(client, "set_dinner", token, date="2026-10-23")["isError"] is True
    assert call(client, "set_dinner", token, date="nope", text="Taco")["isError"] is True
    assert not PlannedDinner.objects.exists()
    assert not McpChange.objects.exists()


def test_clear_dinner_and_the_change_log(client: Client, token: str, lapskaus: Recipe) -> None:
    ok(call(client, "set_dinner", token, date="2026-10-23", recipe_id=lapskaus.id))

    cleared = ok(call(client, "clear_dinner", token, date="2026-10-23"))
    again = ok(call(client, "clear_dinner", token, date="2026-10-23"))

    assert (cleared["cleared"], cleared["title"], again["cleared"]) == (True, "", False)
    last = McpChange.objects.order_by("-id").values_list("tool", "recipe_id", "summary")
    assert list(last) == [
        ("clear_dinner", lapskaus.id, "2026-10-23: fjernet Lapskaus"),
        ("set_dinner", lapskaus.id, "2026-10-23: Lapskaus (6 porsjoner)"),
    ]


def test_recipe_tools_carry_servings(client: Client, token: str) -> None:
    made = ok(call(client, "create_recipe", token, title="Taco", ingredients="lefser", servings=4))
    assert made["servings"] == 4
    assert ok(call(client, "get_recipe", id=made["id"]))["servings"] == 4

    kept = ok(call(client, "update_recipe", token, id=made["id"], title="Fredagstaco"))
    assert (kept["servings"], kept["changed"]) == (4, ["title"])
    removed = ok(call(client, "update_recipe", token, id=made["id"], servings=0))
    assert (removed["servings"], removed["changed"]) == (None, ["servings"])
    last = McpChange.objects.order_by("-id").first()
    assert last is not None
    assert last.summary == "endret: porsjoner"
