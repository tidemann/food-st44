import json
from pathlib import Path
from typing import Any

import pytest
from django.contrib.auth.models import User
from django.test import Client
from django.utils import timezone
from pytest_django import Settings

from food import importer, services
from food.keys import KEY_START, make_key
from food.models import ApiKey, Editor, McpChange, Recipe
from food.reader import UNREADABLE, Draft

pytestmark = pytest.mark.django_db

MCP = "/api/mcp"
JSON = "application/json"


@pytest.fixture(autouse=True)
def site(settings: Settings, tmp_path: Path) -> None:
    settings.FOOD_SITE_URL = "https://food.st44.no"
    settings.FOOD_ADMIN_EMAILS = ["stig@example.com"]
    (tmp_path / "index.html").write_text("<app-root></app-root>", encoding="utf-8")
    settings.SPA_DIR = tmp_path


def rpc(
    client: Client,
    method: str,
    params: dict[str, Any] | None = None,
    *,
    token: str = "",
    message_id: int = 1,
) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    body = {"jsonrpc": "2.0", "id": message_id, "method": method, "params": params or {}}
    response = client.post(MCP, json.dumps(body), content_type=JSON, headers=headers)
    assert response.status_code == 200
    assert response["Content-Type"] == "application/json"
    answer: dict[str, Any] = response.json()
    assert answer["jsonrpc"] == "2.0"
    assert answer["id"] == message_id
    return answer


def call(client: Client, tool: str, token: str = "", **arguments: object) -> dict[str, Any]:
    result: dict[str, Any] = rpc(
        client, "tools/call", {"name": tool, "arguments": arguments}, token=token
    )["result"]
    return result


def ok(result: dict[str, Any]) -> dict[str, Any]:
    assert result["isError"] is False, result
    structured: dict[str, Any] = result["structuredContent"]
    assert json.loads(result["content"][0]["text"]) == structured
    return structured


def refused(result: dict[str, Any]) -> str:
    assert result["isError"] is True
    text: str = result["content"][0]["text"]
    return text


def editor_token(email: str = "kari@example.com", name: str = "Samantha") -> str:
    user = User.objects.create(username=f"google:{email}", email=email)
    Editor.objects.create(email=email)
    return make_key(user, name)[1]


@pytest.fixture
def recipes() -> list[Recipe]:
    return [
        services.create_recipe(
            title="Kjøttkaker", ingredients="kjøttdeig\nløk", instructions="Form.", tags=["middag"]
        ),
        services.create_recipe(title="Sveler", ingredients="mel\nmelk", instructions="Stek."),
    ]


# --- the protocol ---


def test_initialize_answers_with_the_servers_capabilities(client: Client) -> None:
    result = rpc(
        client,
        "initialize",
        {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t"}},
    )["result"]
    assert result["protocolVersion"] == "2025-06-18"
    assert result["capabilities"] == {"tools": {"listChanged": False}}
    assert result["serverInfo"]["name"] == "food.st44.no"


def test_initialize_with_an_unknown_version_gets_the_newest(client: Client) -> None:
    result = rpc(client, "initialize", {"protocolVersion": "1999-01-01"})["result"]
    assert result["protocolVersion"] == "2025-11-25"


def test_ping_and_unknown_methods(client: Client) -> None:
    assert rpc(client, "ping")["result"] == {}
    assert rpc(client, "resources/list")["error"]["code"] == -32601


def test_a_notification_gets_202_and_no_body(client: Client) -> None:
    body = {"jsonrpc": "2.0", "method": "notifications/initialized"}
    response = client.post(MCP, body, content_type=JSON)
    assert response.status_code == 202
    assert response.content == b""


def test_bad_json_is_a_parse_error_not_a_crash(client: Client) -> None:
    response = client.post(MCP, "{nope", content_type=JSON)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == -32700
    response = client.post(MCP, {"id": 1, "method": "ping"}, content_type=JSON)
    assert response.json()["error"]["code"] == -32600


def test_get_is_not_offered(client: Client) -> None:
    response = client.get(MCP)
    assert response.status_code == 405
    assert response["Allow"] == "POST"


def test_a_page_on_another_site_cannot_call_it(client: Client) -> None:
    body = {"jsonrpc": "2.0", "id": 1, "method": "ping"}
    response = client.post(MCP, body, content_type=JSON, headers={"Origin": "https://evil.test"})
    assert response.status_code == 403


def test_an_unsupported_protocol_header_is_400(client: Client) -> None:
    body = {"jsonrpc": "2.0", "id": 1, "method": "ping"}
    headers = {"MCP-Protocol-Version": "1999-01-01"}
    assert client.post(MCP, body, content_type=JSON, headers=headers).status_code == 400
    headers = {"MCP-Protocol-Version": "2025-06-18"}
    assert client.post(MCP, body, content_type=JSON, headers=headers).status_code == 200


def test_the_tools_are_listed_and_none_deletes(client: Client) -> None:
    tools = rpc(client, "tools/list")["result"]["tools"]
    names = [tool["name"] for tool in tools]
    assert names == [
        "search_recipes",
        "get_recipe",
        "list_tags",
        "import_recipe_from_link",
        "create_recipe",
        "update_recipe",
    ]
    assert not [name for name in names if "delete" in name or "remove" in name]
    for tool in tools:
        assert tool["inputSchema"]["type"] == "object"
        assert tool["annotations"]["destructiveHint"] is False
    reads = {t["name"] for t in tools if t["annotations"]["readOnlyHint"]}
    assert reads == {"search_recipes", "get_recipe", "list_tags"}


def test_an_unknown_tool_is_an_invalid_params_error(client: Client) -> None:
    answer = rpc(client, "tools/call", {"name": "delete_recipe", "arguments": {"id": 1}})
    assert answer["error"]["code"] == -32602


# --- reads: anonymous ---


def test_search_recipes_is_the_sites_search(client: Client, recipes: list[Recipe]) -> None:
    every = ok(call(client, "search_recipes"))
    assert every["count"] == 2
    assert [r["title"] for r in every["recipes"]] == ["Sveler", "Kjøttkaker"]

    found = ok(call(client, "search_recipes", query="KJØTT"))["recipes"]
    assert found == [
        {
            "id": recipes[0].id,
            "title": "Kjøttkaker",
            "description": "",
            "tags": ["middag"],
            "link": f"https://food.st44.no/recipes/{recipes[0].id}",
        }
    ]
    assert ok(call(client, "search_recipes", tag="Middag"))["count"] == 1
    assert ok(call(client, "search_recipes", query="sveler", tag="middag"))["count"] == 0


def test_get_recipe(client: Client, recipes: list[Recipe]) -> None:
    recipe = ok(call(client, "get_recipe", id=recipes[0].id))
    assert recipe["title"] == "Kjøttkaker"
    assert recipe["ingredients"] == "kjøttdeig\nløk"
    assert recipe["instructions"] == "Form."
    assert recipe["tags"] == ["middag"]
    assert recipe["link"] == f"https://food.st44.no/recipes/{recipes[0].id}"

    assert refused(call(client, "get_recipe", id=999)) == "Fant ingen oppskrift med id 999."
    assert "id" in refused(call(client, "get_recipe"))


def test_list_tags(client: Client, recipes: list[Recipe]) -> None:
    assert ok(call(client, "list_tags")) == {"tags": [{"name": "middag", "count": 1}]}


def test_reads_work_with_a_deleted_key_too(client: Client, recipes: list[Recipe]) -> None:
    assert ok(call(client, "search_recipes", token=KEY_START + "nope"))["count"] == 2


# --- writes: an editor's key ---


def test_create_recipe_with_an_editors_key(client: Client) -> None:
    token = editor_token()
    made = ok(
        call(
            client,
            "create_recipe",
            token,
            title=" Fårikål ",
            ingredients="lam\nkål",
            tags=["Middag", "høst"],
        )
    )
    recipe = Recipe.objects.get()
    assert made["id"] == recipe.id
    assert made["title"] == "Fårikål"
    assert made["tags"] == ["høst", "middag"]
    assert made["link"] == f"https://food.st44.no/recipes/{recipe.id}"

    change = McpChange.objects.get()
    assert change.user is not None
    assert change.user.email == "kari@example.com"
    assert change.via == "Samantha"
    assert change.tool == "create_recipe"
    assert change.recipe_id == recipe.id
    assert change.summary == "ny oppskrift: Fårikål"


def test_create_recipe_keeps_the_sites_rules(client: Client) -> None:
    token = editor_token()
    message = refused(call(client, "create_recipe", token, title=" ", ingredients="x"))
    assert "Tittelen må fylles ut." in message
    assert "ingredients" in refused(call(client, "create_recipe", token, title="x"))
    assert Recipe.objects.count() == 0
    assert McpChange.objects.count() == 0


def test_update_recipe_changes_only_the_fields_given(client: Client, recipes: list[Recipe]) -> None:
    token = editor_token()
    recipe = recipes[0]

    updated = ok(call(client, "update_recipe", token, id=recipe.id, tags=["middag", "Kjøtt"]))

    assert updated["tags"] == ["kjøtt", "middag"]
    assert updated["changed"] == ["tags"]
    recipe.refresh_from_db()
    assert (recipe.title, recipe.ingredients, recipe.instructions) == (
        "Kjøttkaker",
        "kjøttdeig\nløk",
        "Form.",
    )
    assert McpChange.objects.get().summary == "endret: emneord"

    ok(call(client, "update_recipe", token, id=recipe.id, title="Kjøttkaker i brun saus"))
    recipe.refresh_from_db()
    assert recipe.title == "Kjøttkaker i brun saus"
    assert services.tag_names(recipe) == ["kjøtt", "middag"]
    assert McpChange.objects.values_list("summary", flat=True)[0] == "endret: tittel"


def test_an_update_that_changes_nothing_logs_nothing(client: Client, recipes: list[Recipe]) -> None:
    token = editor_token()
    result = ok(call(client, "update_recipe", token, id=recipes[0].id, tags=["middag"]))
    assert result["changed"] == []
    assert McpChange.objects.count() == 0


def test_update_a_missing_recipe(client: Client) -> None:
    token = editor_token()
    assert refused(call(client, "update_recipe", token, id=42)) == "Fant ingen oppskrift med id 42."


def test_import_recipe_from_link_saves_it(client: Client, monkeypatch: pytest.MonkeyPatch) -> None:
    token = editor_token()
    seen: list[str] = []

    def fake(url: str) -> Draft:
        seen.append(url)
        return Draft(title="Lapskaus", ingredients="kjøtt\npotet", instructions="Kok.")

    monkeypatch.setattr(importer, "import_link", fake)
    made = ok(call(client, "import_recipe_from_link", token, url="matprat.no/lapskaus"))

    assert seen == ["https://matprat.no/lapskaus"]
    assert made["title"] == "Lapskaus"
    assert Recipe.objects.get().ingredients == "kjøtt\npotet"
    change = McpChange.objects.get()
    assert change.tool == "import_recipe_from_link"
    assert change.summary == "hentet fra https://matprat.no/lapskaus"


def test_import_refuses_what_the_site_refuses(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    token = editor_token()
    assert refused(call(client, "import_recipe_from_link", token, url="http://127.0.0.1/x")) == (
        importer.NOT_ALLOWED
    )
    monkeypatch.setattr(importer, "import_link", lambda url: UNREADABLE)
    assert "Fant ingen oppskrift" in refused(
        call(client, "import_recipe_from_link", token, url="https://example.com/")
    )
    assert Recipe.objects.count() == 0


# --- writes: everyone else is refused, clearly ---

WRITES: list[tuple[str, dict[str, Any]]] = [
    ("create_recipe", {"title": "x", "ingredients": "y"}),
    ("update_recipe", {"id": 1, "title": "z"}),
    ("import_recipe_from_link", {"url": "https://example.com/"}),
]


def refusals(client: Client, token: str) -> list[str]:
    services.create_recipe(title="Sveler", ingredients="mel", instructions="")
    messages = [refused(call(client, tool, token, **args)) for tool, args in WRITES]
    assert Recipe.objects.get().title == "Sveler"
    assert McpChange.objects.count() == 0
    return messages


def test_writes_without_a_key_are_refused(client: Client) -> None:
    for message in refusals(client, ""):
        assert "krever en nøkkel" in message


def test_writes_with_an_unknown_key_are_refused(client: Client) -> None:
    token = editor_token()
    for message in refusals(client, token + "x"):
        assert "finnes ikke eller er slettet" in message


def test_writes_with_a_deleted_key_are_refused(client: Client) -> None:
    token = editor_token()
    user = User.objects.get()
    ApiKey.objects.filter(user=user).update(deleted_at=timezone.now())
    for message in refusals(client, token):
        assert "finnes ikke eller er slettet" in message


def test_writes_with_a_key_of_someone_no_longer_an_editor_are_refused(client: Client) -> None:
    token = editor_token()
    Editor.objects.all().delete()
    for message in refusals(client, token):
        assert message == "Kontoen nøkkelen hører til, er ikke lenger redaktør."


def test_a_signed_in_session_does_not_write_through_mcp(client: Client) -> None:
    """The endpoint takes keys only: no cookie, so no cross-site request can ride a session."""
    user = User.objects.create(username="google:s", email="stig@example.com")
    client.force_login(user)
    for message in refusals(client, ""):
        assert "krever en nøkkel" in message


def test_an_admin_emails_key_writes(client: Client) -> None:
    user = User.objects.create(username="google:s", email="stig@example.com")
    token = make_key(user, "Stig sin")[1]
    ok(call(client, "create_recipe", token, title="x", ingredients="y"))


# --- the routes around it ---


@pytest.mark.parametrize(
    "path",
    [
        "/assistent",
        "/assistent/",
        "/assistent/nokler",
        "/assistent/nokler/ny",
        "/assistent/nokler/3/slett",
    ],
)
def test_the_help_and_key_pages_are_the_spa(client: Client, path: str) -> None:
    response = client.get(path)
    assert response.status_code == 200
    assert "<app-root>" in response.text


def test_healthz_is_still_ok(client: Client) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.content == b"ok"
