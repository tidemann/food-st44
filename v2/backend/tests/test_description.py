"""The recipe's description (ST-1937): what is kept of its HTML, how long it may be, and that the
site, search, an import and the MCP tools all treat it the same way."""

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest
from django.contrib.auth.models import User
from django.test import Client
from pytest_django import Settings

from food import description, importer, services
from food.keys import make_key
from food.models import Editor, Recipe
from food.reader import Draft

if TYPE_CHECKING:
    from django.test.client import _MonkeyPatchedWSGIResponse as Response

pytestmark = pytest.mark.django_db

JSON = "application/json"
REL = 'rel="noopener nofollow"'


# --- cleaning ---


@pytest.mark.parametrize(
    ("given", "kept"),
    [
        ("Grønnkål stuet i melk.", "Grønnkål stuet i melk."),
        (
            "<p>Dette er <strong>søndagsmiddagen</strong>, <b>med</b> <i>litt</i> <em>av</em> "
            "<u>alt</u>.<br>Hei</p>",
            "<p>Dette er <strong>søndagsmiddagen</strong>, <b>med</b> <i>litt</i> <em>av</em> "
            "<u>alt</u>.<br>Hei</p>",
        ),
        (
            "<ul><li>Salt</li></ul><ol><li>Kok</li></ol>",
            "<ul><li>Salt</li></ul><ol><li>Kok</li></ol>",
        ),
        # Scripts and styles go with their content; other tags leave their text.
        ("Hei<script>alert(1)</script>", "Hei"),
        ("<style>p{color:red}</style>Hei", "Hei"),
        ("<h2>Overskrift</h2><img src=x onerror=alert(1)>tekst", "Overskrifttekst"),
        ("<table><tr><td>celle</td></tr></table>", "celle"),
        # Attributes other than a link's address go.
        ('<p class="x" style="color:red" onclick="alert(1)">Hei</p>', "<p>Hei</p>"),
        ('<b title="t">fet</b>', "<b>fet</b>"),
        # Unclosed tags are closed, so a description cannot spill over the page.
        ("<b>fet", "<b>fet</b>"),
        ("a < b & c", "a &lt; b &amp; c"),
        ("  Hei  ", "Hei"),
        # Nothing but tags or space is no description.
        ("<p> </p><br>", ""),
        ("", ""),
    ],
)
def test_clean_keeps_only_the_allowed_tags(given: str, kept: str) -> None:
    assert description.clean(given) == kept


def test_a_link_keeps_only_an_http_or_https_address_and_opens_safely() -> None:
    cleaned = description.clean(
        '<a href="https://food.st44.no/recipes/1" target="_blank" class="x">Lapskaus</a>'
    )
    assert cleaned == f'<a href="https://food.st44.no/recipes/1" {REL}>Lapskaus</a>'
    assert description.clean('<a href="http://example.com">x</a>') == (
        f'<a href="http://example.com" {REL}>x</a>'
    )
    for bad in ("javascript:alert(1)", "data:text/html,hei", "/recipes/1", "mailto:a@b.no"):
        assert description.clean(f'<a href="{bad}">x</a>') == f"<a {REL}>x</a>", bad


def test_text_drops_the_tags_and_keeps_words_apart() -> None:
    assert description.text("<p>Første.</p><p>Andre &amp; <b>tredje</b>.</p>") == (
        "Første. Andre & tredje."
    )
    assert description.text("<ul><li>Salt</li><li>Pepper</li></ul>Hei<br>du") == (
        "Salt Pepper Hei du"
    )
    assert description.text("") == ""


# --- the API ---


@pytest.fixture
def editor(client: Client) -> User:
    user = User.objects.create(username="google:editor", email="editor@example.com")
    Editor.objects.create(email=user.email)
    client.force_login(user)
    return user


def save(client: Client, text: str, recipe_id: int | None = None) -> "Response":
    body = json.dumps({"title": "Kjøttkaker", "ingredients": "kjøttdeig", "description": text})
    if recipe_id is None:
        return client.post("/api/recipes", body, content_type=JSON)
    return client.put(f"/api/recipes/{recipe_id}", body, content_type=JSON)


def test_the_api_stores_the_description_cleaned(client: Client, editor: User) -> None:
    response = save(client, '<p onclick="x()">Dette er <strong>søndagsmiddagen</strong>.</p>')

    assert response.status_code == 201
    made = response.json()
    assert made["description"] == "<p>Dette er <strong>søndagsmiddagen</strong>.</p>"
    assert made["description_text"] == "Dette er søndagsmiddagen."
    assert Recipe.objects.get().description == made["description"]

    edited = save(client, "<script>x()</script>Kort.", made["id"]).json()
    assert edited["description"] == "Kort."
    assert Recipe.objects.get().description == "Kort."


def test_the_limit_counts_text_not_tags(client: Client, editor: User) -> None:
    exactly = "<p><strong>" + "a" * 500 + "</strong></p>"
    assert save(client, exactly).status_code == 201

    response = save(client, "<p>" + "a" * 571 + "</p>")
    assert response.status_code == 422
    assert response.json() == {
        "errors": {
            "description": "Beskrivelsen kan ikke være lengre enn 500 tegn. "
            "Kort den ned med 71 tegn."
        }
    }
    assert Recipe.objects.count() == 1


def test_a_recipe_without_a_description_still_saves_and_reads(client: Client, editor: User) -> None:
    """Old recipes and clients that never send one: the field is empty, nothing breaks."""
    old = Recipe.objects.create(title="Lapskaus", ingredients="kjøtt")
    body = json.dumps({"title": "Sveler", "ingredients": "mel"})

    assert client.post("/api/recipes", body, content_type=JSON).json()["description"] == ""
    read = client.get(f"/api/recipes/{old.id}").json()
    assert (read["description"], read["description_text"]) == ("", "")


def test_search_finds_words_in_the_description_text_not_its_tags(client: Client) -> None:
    services.create_recipe(
        title="Fiskegrateng",
        ingredients="torsk",
        instructions="",
        description="Med en hvit <strong>SAUS</strong> som smaker av muskat.",
    )
    services.create_recipe(title="Kjøttkaker i brun saus", ingredients="kjøttdeig", instructions="")
    services.create_recipe(
        title="Sveler", ingredients="mel", instructions="", description="<p><b>Søtt</b></p>"
    )

    def found(q: str) -> list[str]:
        return [recipe["title"] for recipe in client.get("/api/recipes", {"q": q}).json()]

    assert found("saus") == ["Kjøttkaker i brun saus", "Fiskegrateng"]
    assert found("muskat") == ["Fiskegrateng"]
    assert found("strong") == []
    assert found("søtt") == ["Sveler"]


# --- an import from a link ---


def page(recipe: dict[str, object], head: str = "") -> str:
    script = f'<script type="application/ld+json">{json.dumps(recipe)}</script>'
    return f"<!doctype html><html><head>{head}{script}</head><body></body></html>"


RECIPE: dict[str, object] = {"@type": "Recipe", "name": "Lapskaus", "recipeIngredient": ["kjøtt"]}


def test_an_import_takes_the_recipes_own_intro_with_allowed_formatting() -> None:
    intro = '<p>En <strong>god</strong> gryte.</p><img src="x.jpg"><h2>Mer</h2>'
    draft = importer.from_html(page({**RECIPE, "description": intro}))
    assert draft.description == "<p>En <strong>god</strong> gryte.</p>Mer"


def test_an_import_reads_an_escaped_intro_and_plain_text_safely() -> None:
    escaped = "&lt;p&gt;Kjøtt &amp;amp; kål&lt;/p&gt;&lt;script&gt;x()&lt;/script&gt;"
    assert importer.from_html(page({**RECIPE, "description": escaped})).description == (
        "<p>Kjøtt &amp; kål</p>"
    )


def test_an_import_without_an_intro_in_the_recipe_uses_the_pages_meta_description() -> None:
    head = '<meta name="description" content="Lapskaus som hos mormor.">'
    assert importer.from_html(page(RECIPE, head)).description == "Lapskaus som hos mormor."
    head = '<meta property="og:description" content="Fra og-taggen.">'
    assert importer.from_html(page(RECIPE, head)).description == "Fra og-taggen."
    assert importer.from_html(page(RECIPE)).description == ""


def test_a_long_intro_is_cut_after_the_last_whole_sentence_that_fits() -> None:
    sentence = "Dette er en <b>lang</b> setning om retten. "  # 35 characters of text
    draft = importer.from_html(page({**RECIPE, "description": sentence * 20}))
    plain = description.text(draft.description)
    assert len(plain) <= description.MAX_CHARS
    assert plain.endswith("retten.")
    assert "<b>" not in draft.description  # the formatting goes with the cut
    # No sentence end within the limit: no description rather than half a word.
    assert importer.from_html(page({**RECIPE, "description": "a" * 600})).description == ""


def test_the_saved_matprat_page_gets_its_intro() -> None:
    matprat = (Path(__file__).parent / "fixtures/matprat-aspargessuppe.html").read_text()
    draft = importer.from_html(matprat)
    assert draft.description
    assert len(description.text(draft.description)) <= description.MAX_CHARS
    assert description.clean(draft.description) == draft.description


def test_the_import_endpoint_sends_the_description_to_the_form(
    client: Client, editor: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        importer,
        "import_link",
        lambda url: Draft(title="Lapskaus", ingredients="kjøtt", description="<i>Godt.</i>"),
    )
    response = client.post(
        "/api/recipes/import-link", json.dumps({"url": "https://x.no"}), content_type=JSON
    )
    assert response.json()["description"] == "<i>Godt.</i>"
    assert not Recipe.objects.exists()


# --- the MCP tools ---


@pytest.fixture
def site(settings: Settings, tmp_path: Path) -> None:
    settings.FOOD_SITE_URL = "https://food.st44.no"
    (tmp_path / "index.html").write_text("<app-root></app-root>", encoding="utf-8")
    settings.SPA_DIR = tmp_path


def token() -> str:
    user = User.objects.create(username="google:kari@example.com", email="kari@example.com")
    Editor.objects.create(email=user.email)
    return make_key(user, "Samantha")[1]


def call(client: Client, tool: str, key: str = "", **arguments: object) -> dict[str, Any]:
    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": tool, "arguments": arguments},
    }
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    result: dict[str, Any] = client.post(
        "/api/mcp", json.dumps(body), content_type=JSON, headers=headers
    ).json()["result"]
    return result


def test_mcp_create_and_update_clean_the_description_like_the_site(
    client: Client, site: None
) -> None:
    key = token()
    made = call(
        client,
        "create_recipe",
        key,
        title="Lapskaus",
        ingredients="kjøtt",
        description='<p style="x">Godt <a href="javascript:x()">her</a>.</p>',
    )["structuredContent"]
    assert made["description"] == f"<p>Godt <a {REL}>her</a>.</p>"

    kept = call(client, "update_recipe", key, id=made["id"], title="Lapskaus nå")
    assert kept["structuredContent"]["description"] == made["description"]
    assert kept["structuredContent"]["changed"] == ["title"]

    changed = call(client, "update_recipe", key, id=made["id"], description="<b>Nytt</b>")
    assert changed["structuredContent"]["description"] == "<b>Nytt</b>"
    assert changed["structuredContent"]["changed"] == ["description"]

    cleared = call(client, "update_recipe", key, id=made["id"], description="")
    assert cleared["structuredContent"]["description"] == ""

    too_long = call(client, "update_recipe", key, id=made["id"], description="a" * 501)
    assert too_long["isError"] is True
    assert "Kort den ned med 1 tegn." in too_long["content"][0]["text"]


def test_mcp_reads_return_the_description_and_search_finds_it(client: Client, site: None) -> None:
    recipe = services.create_recipe(
        title="Fiskegrateng", ingredients="torsk", instructions="", description="Hvit <b>saus</b>."
    )
    assert call(client, "get_recipe", id=recipe.id)["structuredContent"]["description"] == (
        "Hvit <b>saus</b>."
    )
    found = call(client, "search_recipes", query="saus")["structuredContent"]["recipes"]
    assert [(r["title"], r["description"]) for r in found] == [
        ("Fiskegrateng", "Hvit <b>saus</b>.")
    ]


def test_mcp_import_fills_the_description(
    client: Client, site: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        importer,
        "import_link",
        lambda url: Draft(title="Lapskaus", ingredients="kjøtt", description="<i>Godt.</i>"),
    )
    made = call(client, "import_recipe_from_link", token(), url="https://x.no")
    assert made["structuredContent"]["description"] == "<i>Godt.</i>"
    assert Recipe.objects.get().description == "<i>Godt.</i>"
