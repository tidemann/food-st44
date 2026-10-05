import gzip
import json
import socket
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING, Any, ClassVar

import pytest
from django.contrib.auth.models import User
from django.test import Client
from pytest_django import Settings

from food import importer
from food.models import Editor, PhotoRead, Recipe
from food.reader import UNREADABLE, Draft

if TYPE_CHECKING:
    from django.test.client import _MonkeyPatchedWSGIResponse as Response

pytestmark = pytest.mark.django_db

LINK = "/api/recipes/import-link"
TEXT = "/api/recipes/import-text"
# A matprat.no recipe page as served on 2026-10-05, saved whole: a top-level JSON-LD list with
# HowToStep instructions. CI never fetches the live site.
MATPRAT = (Path(__file__).parent / "fixtures/matprat-aspargessuppe.html").read_text()


def fixture(name: str) -> str:
    return (Path(__file__).parent / "fixtures" / name).read_text()


# Stig's five test links (ST-674), saved whole on 2026-10-05. Weissman's JSON-LD Recipe has only
# a name: the recipe is in the page's HTML. aperitif's steps end with its own promotion.
WEISSMAN = fixture("weissman-cubanos.html")
APERITIF = fixture("aperitif-kung-fu-coleslaw.html")


@pytest.fixture
def editor(client: Client) -> User:
    user = User.objects.create(username="google:editor@example.com", email="editor@example.com")
    Editor.objects.create(email=user.email)
    client.force_login(user)
    return user


def post(client: Client, url: str, body: dict[str, str]) -> "Response":
    return client.post(url, json.dumps(body), content_type="application/json")


def page(*blocks: object) -> str:
    scripts = "".join(
        f'<script type="application/ld+json">{json.dumps(block)}</script>' for block in blocks
    )
    return f"<!doctype html><html><head>{scripts}</head><body><h1>Hei</h1></body></html>"


# --- schema.org Recipe in JSON-LD ---


def test_a_saved_matprat_page() -> None:
    draft = importer.from_html(MATPRAT)

    assert draft.title == "Aspargessuppe"
    assert draft.ingredients.splitlines() == [
        "500 g frisk grønn asparges eller hvit asparges",
        "1 stk. løk",
        "5 dl grønnsakbuljong (utblandet) eller hønsebuljong",
        "2 dl matfløte",
        "2 ss margarin",
        "1 ss sitronsaft",
    ]
    steps = draft.instructions.splitlines()
    assert len(steps) == 5
    assert steps[0] == "Brekk av eller skjær vekk nederste del av aspargesen. Skrell hvit asparges."
    assert steps[-1].startswith("Kok aspargestoppene møre")


@pytest.mark.parametrize(
    ("name", "title", "first_ingredient", "ingredients", "steps"),
    [
        (
            "foodcom-beef-wet-burritos.html",
            "Beef Wet Burritos Hacienda-Style!",
            "1 (3 lb) chuck roast, trim outer fat",
            22,
            32,
        ),
        (
            "therecipecritic-beef-bourguignon.html",
            "Slow Cooker Beef Bourguignon",
            "5 slices diced bacon",
            13,
            5,
        ),
        (
            "cookieandkate-enchilada-sauce.html",
            "Homemade Enchilada Sauce",
            "3 tablespoons olive oil",
            12,
            5,
        ),
    ],
)
def test_the_links_that_passed_qa_still_do(
    name: str, title: str, first_ingredient: str, ingredients: int, steps: int
) -> None:
    draft = importer.from_html(fixture(name))

    assert draft.title == title
    assert draft.ingredients.splitlines()[0] == first_ingredient
    assert len(draft.ingredients.splitlines()) == ingredients
    assert len(draft.instructions.splitlines()) == steps


def test_a_page_whose_json_ld_has_only_a_name_is_read_from_its_text() -> None:
    draft = importer.from_html(WEISSMAN)

    assert draft.title == "How To Make Cubanos with Homemade Cuban Bread"
    ingredients = draft.ingredients.splitlines()
    assert "1 Tbsp (10g) active dry yeast" in ingredients
    assert "Mojo Braised Pork:" in ingredients
    assert ingredients[-1] == "Sliced Swiss cheese"
    steps = draft.instructions.splitlines()
    assert steps[0] == "Sandwich Bread:"
    assert steps[1] == "Lightly grease a large bowl with cooking spray and set aside."
    assert "Tip: Make this a day or two ahead of time if you will be toasting it." in steps
    # It stops at the next heading: no comments, sign-in or "Other recipes".
    assert steps[-1] == "Remove from the pan. Cut into two diagonal slices and enjoy."
    assert len(steps) == 39


def test_site_promotion_is_dropped_from_the_steps() -> None:
    draft = importer.from_html(APERITIF)

    assert draft.title == "Kung Fu Coleslaw"
    assert len(draft.ingredients.splitlines()) == 11
    assert draft.instructions.splitlines() == [
        "Bland grønnsakene. Bland dressingen og hell over grønnsakene rett før servering.",
        "Kålsalaten passer perfekt til denne ribbeoppskriften",
    ]


@pytest.mark.parametrize(
    "promotion",
    [
        "Bli abonnent på aperitif + og oppnå store fordeler samtidig",
        "Lag din egen personlige kokebok her.",
        "Få dagens rett som nyhetsbrev",
        "Abonner på bladet!",
        "Subscribe to our newsletter for more recipes.",
    ],
)
def test_a_promotion_line_is_not_a_step(promotion: str) -> None:
    steps = ["Rør inn smøret.", promotion, "Server med brød."]
    recipe = {"@type": "Recipe", "name": "Grøt", "recipeInstructions": steps}

    assert importer.from_html(page(recipe)).instructions == "Rør inn smøret.\nServer med brød."


def test_the_page_text_is_read_inside_main_and_stops_at_the_next_heading() -> None:
    html = """<html><head><title>Bloggen</title></head><body>
    <nav><h2>Ingredienser</h2><a href="/">Hjem</a></nav>
    <main>
      <h1>Pannekaker</h1><p>Som mormor lagde dem.</p>
      <h2>Ingredienser</h2><ul><li>3 egg</li><li>5 dl <b>melk</b></li><li>Salt</li></ul>
      <h2>Fremgangsmåte</h2>
      <ol><li>Visp alt sammen.</li><li>Stek tynne kaker.</li></ol>
      <p>Få dagens rett som nyhetsbrev</p>
      <h2>Kommentarer</h2><p>Så gode!</p>
      <form><label>Navn</label></form>
    </main>
    <footer>Om oss</footer><script>var x = "<h2>Ingredienser</h2>";</script>
    </body></html>"""

    assert importer.from_html(html) == Draft(
        title="Pannekaker",
        ingredients="3 egg\n5 dl melk\nSalt",
        instructions="Visp alt sammen.\nStek tynne kaker.",
    )


def test_the_json_ld_name_titles_a_recipe_read_from_the_text() -> None:
    html = page({"@type": "Recipe", "name": "Vafler"}).replace(
        "<h1>Hei</h1>",
        "<h1>Hei</h1><p><strong>Ingredienser</strong></p><p>4 egg</p>"
        "<p><strong>Slik gjør du</strong></p><p>Stek dem.</p>"
        "<h3>Flere oppskrifter</h3><p>Boller</p>",
    )

    assert importer.from_html(html) == Draft(
        title="Vafler", ingredients="4 egg", instructions="Stek dem."
    )


def test_a_plain_recipe_with_instructions_as_one_string() -> None:
    draft = importer.from_html(
        page(
            {
                "@context": "https://schema.org",
                "@type": "Recipe",
                "name": "  Fisk &amp; chips ",
                "recipeIngredient": ["400 g torsk", " 1  kg poteter "],
                "recipeInstructions": "Skrell potetene.\nStek fisken.<br>Server.",
            }
        )
    )

    assert draft == Draft(
        title="Fisk & chips",
        ingredients="400 g torsk\n1 kg poteter",
        instructions="Skrell potetene.\nStek fisken.\nServer.",
    )


def test_html_in_the_instruction_string_becomes_steps() -> None:
    draft = importer.from_html(
        page(
            {
                "@type": "Recipe",
                "name": "Vafler",
                "recipeIngredient": ["3 egg"],
                "recipeInstructions": "<ol><li>Visp egg.</li><li>Stek &amp; server.</li></ol>",
            }
        )
    )

    assert draft.instructions == "Visp egg.\nStek & server."


def test_a_recipe_inside_a_graph() -> None:
    graph = {
        "@context": "https://schema.org",
        "@graph": [
            {"@type": "WebPage", "name": "Bloggen min"},
            {"@type": "Person", "name": "Kari"},
            {
                "@type": ["Recipe", "NewsArticle"],
                "name": "Lapskaus",
                "recipeIngredient": ["500 g kjøtt", "6 poteter"],
                "recipeInstructions": [
                    {
                        "@type": "HowToSection",
                        "name": "Forberedelser",
                        "itemListElement": [
                            {"@type": "HowToStep", "text": "Skjær kjøttet i terninger."},
                        ],
                    },
                    {
                        "@type": "HowToSection",
                        "name": "Koking",
                        "itemListElement": [
                            {"@type": "HowToStep", "text": "Kok alt i en time."},
                            {"@type": "HowToStep", "name": "Smak til med salt."},
                        ],
                    },
                ],
            },
        ],
    }

    draft = importer.from_html(page(graph))

    assert draft.title == "Lapskaus"
    assert draft.ingredients == "500 g kjøtt\n6 poteter"
    assert (
        draft.instructions == "Skjær kjøttet i terninger.\nKok alt i en time.\nSmak til med salt."
    )


def test_a_howtostep_list_and_a_list_of_strings() -> None:
    steps = [{"@type": "HowToStep", "text": "Først dette."}, "Så dette."]
    recipe = {"@type": "schema:Recipe", "name": "Grøt", "recipeInstructions": steps}

    draft = importer.from_html(page({**recipe, "recipeIngredient": "2 dl ris"}))

    assert draft.ingredients == "2 dl ris"
    assert draft.instructions == "Først dette.\nSå dette."


def test_a_broken_block_and_other_types_are_skipped() -> None:
    html = (
        '<script type="application/ld+json">{"@type": "Recipe", nope</script>'
        + page({"@type": "Organization", "name": "Matbloggen"})
        + page({"@type": "Recipe", "name": "Boller", "recipeIngredient": ["1 kg mel"]})
    )

    assert importer.from_html(html).title == "Boller"


@pytest.mark.parametrize(
    "html",
    [
        "<html><body><h1>Boller</h1><p>1 kg mel</p></body></html>",
        page({"@type": "Article", "name": "Ti tips til middag"}),
        page({"@type": "Recipe"}),
        # A name alone, and nothing in the page text either: "Fant ingen oppskrift".
        page({"@type": "Recipe", "name": "Boller"}),
        "<html><body><h2>Ingredienser</h2><h2>Fremgangsmåte</h2></body></html>",
        "",
    ],
)
def test_a_page_without_recipe_data_is_unreadable(html: str) -> None:
    assert importer.from_html(html) == UNREADABLE


# --- the SSRF guard ---


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.5",
        "172.16.0.1",
        "192.168.1.1",
        "169.254.169.254",  # cloud metadata
        "100.64.0.1",  # carrier-grade NAT
        "0.0.0.0",  # noqa: S104
        "224.0.0.1",
        "::1",
        "fe80::1%eth0",
        "fc00::1",
        "::ffff:127.0.0.1",
        "::ffff:10.0.0.1",
        "64:ff9b::7f00:1",  # NAT64 to 127.0.0.1
        "64:ff9b::a9fe:a9fe",  # NAT64 to 169.254.169.254
    ],
)
def test_private_and_loopback_addresses_are_not_public(address: str) -> None:
    assert not importer.is_public(address)


@pytest.mark.parametrize(
    "address",
    ["93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c", "64:ff9b::5db8:d70e"],
)
def test_public_addresses_are(address: str) -> None:
    assert importer.is_public(address)


@pytest.mark.parametrize(
    ("url", "message"),
    [
        ("file:///etc/passwd", importer.BAD_URL),
        ("ftp://example.com/oppskrift", importer.BAD_URL),
        ("gopher://example.com/", importer.BAD_URL),
        ("https://", importer.BAD_URL),
        ("https://example.com:99999/", importer.BAD_URL),
        ("https://user:pass@example.com/", importer.NOT_ALLOWED),
        ("http://example.com:8080/", importer.NOT_ALLOWED),
        ("https://example.com:22/", importer.NOT_ALLOWED),
    ],
)
def test_only_http_and_https_on_the_usual_ports(url: str, message: str) -> None:
    with pytest.raises(importer.NotAllowed, match=message):
        importer.check_url(url)


def fake_dns(monkeypatch: pytest.MonkeyPatch, *addresses: str) -> None:
    def getaddrinfo(host: str, port: int, **kwargs: object) -> list[tuple[Any, ...]]:
        if not addresses:
            raise socket.gaierror("no such name")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (a, port)) for a in addresses]

    monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)


def test_a_name_with_any_private_address_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_dns(monkeypatch, "93.184.215.14", "10.0.0.1")

    with pytest.raises(importer.NotAllowed):
        importer.fetch("https://rebind.example.com/")


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://localhost/admin",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/",
        "http://2130706433/",  # 127.0.0.1 as one number
        "http://0x7f.1/",
        "http://10.0.0.1/",
    ],
)
def test_the_api_refuses_internal_addresses(client: Client, editor: User, url: str) -> None:
    response = post(client, LINK, {"url": url})

    assert response.status_code == 422
    assert response.json() == {"errors": {"url": importer.NOT_ALLOWED}}


def test_an_unknown_host_is_a_clear_answer(
    client: Client, editor: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_dns(monkeypatch)

    response = post(client, LINK, {"url": "https://finnes-ikke.example/"})

    assert response.status_code == 502
    assert response.json() == {"detail": importer.UNKNOWN_HOST}


# --- who may import, and what is checked before anything is fetched ---


@pytest.mark.parametrize(("url", "body"), [(LINK, {"url": "x"}), (TEXT, {"text": "x"})])
def test_anonymous_and_non_editors_get_403(client: Client, url: str, body: dict[str, str]) -> None:
    assert post(client, url, body).status_code == 403
    client.force_login(User.objects.create(username="google:x", email="x@example.com"))
    assert post(client, url, body).status_code == 403


def test_an_empty_link_or_text_is_422(client: Client, editor: User) -> None:
    response = post(client, LINK, {"url": "  "})
    assert response.status_code == 422
    assert response.json() == {"errors": {"url": importer.BAD_URL}}

    response = post(client, TEXT, {"text": "\n \n"})
    assert response.status_code == 422
    assert response.json() == {"errors": {"text": importer.NO_TEXT}}


def test_text_over_the_limit_is_422(client: Client, editor: User) -> None:
    response = post(client, TEXT, {"text": "a" * (importer.TEXT_MAX_CHARS + 1)})

    assert response.status_code == 422
    assert response.json() == {"errors": {"text": importer.TEXT_TOO_LONG}}


# --- fetching, over a real socket: a local stand-in for the recipe site ---


class Site(BaseHTTPRequestHandler):
    """Serves the matprat page at /oppskrift, and a few ways for a site to misbehave."""

    delay = 0.0
    redirect_to = "/oppskrift"
    requests: ClassVar[list[str]] = []

    def do_GET(self) -> None:
        self.requests.append(self.path)
        time.sleep(self.delay)
        if self.path == "/flyttet":
            self.send_response(301)
            self.send_header("Location", self.redirect_to)
            self.end_headers()
        elif self.path == "/oppskrift":
            self.send(200, MATPRAT.encode())
        elif self.path == "/gzip":
            self.send(200, gzip.compress(MATPRAT.encode()), {"Content-Encoding": "gzip"})
        elif self.path == "/latin1":
            body = page({"@type": "Recipe", "name": "Kjøttkaker", "recipeIngredient": ["kjøtt"]})
            self.send(200, body.encode("latin-1"), {"Content-Type": "text/html; charset=latin-1"})
        elif self.path == "/weissman":
            self.send(200, WEISSMAN.encode())
        elif self.path == "/artikkel":
            self.send(200, b"<html><body><h1>Ti tips til middag</h1></body></html>")
        elif self.path == "/stengt":
            self.send(403, b"<h1>Forbidden</h1>")
        elif self.path == "/drypp":
            self.send_response(200)
            self.send_header("Content-Length", "100000")
            self.end_headers()
            for _ in range(100):
                self.wfile.write(b" " * 100)
                self.wfile.flush()
                time.sleep(0.05)
        else:
            self.send(404, b"<h1>Not found</h1>")

    def send(self, status: int, body: bytes, headers: dict[str, str] | None = None) -> None:
        self.send_response(status)
        headers = {"Content-Type": "text/html; charset=utf-8", **(headers or {})}
        for name, value in headers.items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        pass


@dataclass
class StandIn:
    url: str
    handler: type[Site]


@pytest.fixture
def site(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> Iterator[StandIn]:
    """The stand-in. Its loopback address and port are let through the guard, and nothing else
    is: every other private address is still refused."""

    class Handler(Site):
        requests: ClassVar[list[str]] = []

    handler = Handler
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    public = importer.is_public
    monkeypatch.setattr(importer, "is_public", lambda a: a == "127.0.0.1" or public(a))
    monkeypatch.setattr(importer, "ALLOWED_PORTS", frozenset({80, 443, server.server_port}))
    settings.FOOD_IMPORT_TIMEOUT = 0.8
    settings.FOOD_IMPORT_MAX_BYTES = 5 * 1024 * 1024
    yield StandIn(f"http://127.0.0.1:{server.server_port}", handler)
    server.shutdown()
    server.server_close()


def test_a_page_is_fetched_and_read(client: Client, editor: User, site: StandIn) -> None:
    response = post(client, LINK, {"url": site.url + "/oppskrift"})

    assert response.status_code == 200
    body = response.json()
    assert body["readable"] is True
    assert body["title"] == "Aspargessuppe"
    assert body["ingredients"].startswith("500 g frisk grønn asparges")
    assert Recipe.objects.count() == 0  # nothing is saved before "Lagre oppskrift"


def test_a_page_read_from_its_text_is_not_an_ai_read(
    client: Client, editor: User, site: StandIn
) -> None:
    response = post(client, LINK, {"url": site.url + "/weissman"})

    assert response.status_code == 200
    body = response.json()
    assert body["readable"] is True
    assert body["title"] == "How To Make Cubanos with Homemade Cuban Bread"
    assert body["ingredients"]
    assert body["instructions"]
    assert PhotoRead.objects.count() == 0


def test_redirects_gzip_and_charsets(site: StandIn) -> None:
    page = importer.fetch(site.url + "/flyttet")
    assert page.url == site.url + "/oppskrift"
    assert site.handler.requests == ["/flyttet", "/oppskrift"]

    assert importer.import_link(site.url + "/gzip").title == "Aspargessuppe"
    assert importer.import_link(site.url + "/latin1").title == "Kjøttkaker"


@pytest.mark.parametrize(
    "target",
    ["http://169.254.169.254/latest/meta-data/", "http://10.0.0.1/", "file:///etc/passwd"],
)
def test_a_redirect_is_checked_like_the_link(
    client: Client, editor: User, site: StandIn, target: str
) -> None:
    site.handler.redirect_to = target

    response = post(client, LINK, {"url": site.url + "/flyttet"})

    assert response.status_code == 422
    assert site.handler.requests == ["/flyttet"]


def test_a_page_without_recipe_data_is_not_readable(
    client: Client, editor: User, site: StandIn
) -> None:
    response = post(client, LINK, {"url": site.url + "/artikkel"})

    assert response.status_code == 200
    assert response.json() == {
        "readable": False,
        "title": "",
        "ingredients": "",
        "instructions": "",
    }


def test_a_site_that_refuses_and_a_missing_page(
    client: Client, editor: User, site: StandIn
) -> None:
    response = post(client, LINK, {"url": site.url + "/stengt"})
    assert response.status_code == 502
    assert response.json() == {"detail": importer.NOT_FETCHED}

    response = post(client, LINK, {"url": site.url + "/borte"})
    assert response.status_code == 502
    assert response.json() == {"detail": importer.NOT_FOUND}


def test_a_page_over_the_size_limit_is_refused(
    client: Client, editor: User, site: StandIn, settings: Settings
) -> None:
    settings.FOOD_IMPORT_MAX_BYTES = 100_000

    response = post(client, LINK, {"url": site.url + "/oppskrift"})

    assert response.status_code == 502
    assert response.json() == {"detail": importer.TOO_LARGE}


def test_the_size_limit_holds_for_a_compressed_page(site: StandIn, settings: Settings) -> None:
    settings.FOOD_IMPORT_MAX_BYTES = 100_000

    with pytest.raises(importer.FetchError, match=importer.TOO_LARGE):
        importer.fetch(site.url + "/gzip")


def test_a_slow_site_times_out(client: Client, editor: User, site: StandIn) -> None:
    site.handler.delay = 1.5
    started = time.monotonic()

    response = post(client, LINK, {"url": site.url + "/oppskrift"})

    assert response.status_code == 504
    assert response.json() == {"detail": importer.TIMED_OUT}
    assert time.monotonic() - started < 1.4


def test_a_site_that_drips_its_page_times_out_on_the_whole(site: StandIn) -> None:
    started = time.monotonic()

    with pytest.raises(importer.FetchError) as error:
        importer.fetch(site.url + "/drypp")

    assert error.value.timed_out
    assert time.monotonic() - started < 1.4


def test_a_site_that_is_not_listening(site: StandIn, monkeypatch: pytest.MonkeyPatch) -> None:
    with socket.socket() as unused:
        unused.bind(("127.0.0.1", 0))
        port = unused.getsockname()[1]
    monkeypatch.setattr(importer, "ALLOWED_PORTS", frozenset({port}))

    with pytest.raises(importer.FetchError, match=importer.NOT_FETCHED):
        importer.fetch(f"http://127.0.0.1:{port}/")


# --- pasted text ---


def test_text_with_headings() -> None:
    text = """
Kjøttkaker i brun saus

Til 4 porsjoner

Ingredienser:
- 600 g kjøttdeig
- 1 ts salt
• 1 egg

Saus:
- 3 ss smør

Fremgangsmåte:
1. Bland kjøttdeig og salt.
2. Form kaker og stek dem.
3. Lag sausen.
"""
    assert importer.split_text(text) == Draft(
        title="Kjøttkaker i brun saus",
        ingredients="600 g kjøttdeig\n1 ts salt\n1 egg\nSaus:\n3 ss smør",
        instructions="Bland kjøttdeig og salt.\nForm kaker og stek dem.\nLag sausen.",
    )


def test_markdown_headings_in_english() -> None:
    text = (
        "# Pancakes\n\n## Ingredients (8 pancakes)\n* 2 eggs\n* 3 dl milk\n\n"
        "## Method\nStep 1: Whisk.\nStep 2: Fry.\n"
    )
    assert importer.split_text(text) == Draft(
        title="Pancakes",
        ingredients="2 eggs\n3 dl milk",
        instructions="Whisk.\nFry.",
    )


def test_text_without_headings() -> None:
    text = """Sveler
En klassiker fra Sunnmøre, perfekt til kaffen på søndag ettermiddag.

2 egg
1 dl sukker
5 dl kulturmelk
Smør til steking

Visp egg og sukker luftig. Rør inn kulturmelk
og la røren svelle i et kvarter.

Stek svelene i middels varm panne
til de er gylne.
"""
    assert importer.split_text(text) == Draft(
        title="Sveler",
        ingredients="2 egg\n1 dl sukker\n5 dl kulturmelk\nSmør til steking",
        instructions=(
            "Visp egg og sukker luftig. Rør inn kulturmelk og la røren svelle i et kvarter.\n"
            "Stek svelene i middels varm panne til de er gylne."
        ),
    )


def test_steps_on_their_own_lines_stay_apart() -> None:
    text = "Grøt\n2 dl ris\n1 l melk\nKok opp melken og risen under omrøring.\nLa trekke i en time."

    draft = importer.split_text(text)

    assert draft.ingredients == "2 dl ris\n1 l melk"
    assert draft.instructions == "Kok opp melken og risen under omrøring.\nLa trekke i en time."


def test_only_an_instructions_heading() -> None:
    draft = importer.split_text("Toast\n2 brødskiver\nOst\nSlik gjør du\nRist brødet.")

    assert draft.ingredients == "2 brødskiver\nOst"
    assert draft.instructions == "Rist brødet."


def test_no_title_line_when_the_text_starts_with_a_heading() -> None:
    draft = importer.split_text("Ingredienser\n1 kg mel\nFremgangsmåte\nBak.")

    assert draft == Draft(title="", ingredients="1 kg mel", instructions="Bak.")


def test_one_line_is_a_title() -> None:
    assert importer.split_text("  Mormors eplekake  ") == Draft(title="Mormors eplekake")


def test_the_api_splits_text_by_rules_when_reading_is_off_and_saves_nothing(
    client: Client, editor: User, settings: Settings
) -> None:
    settings.FOOD_AI_PROVIDER = "off"  # AI reading of text: tests/test_reader.py

    response = post(client, TEXT, {"text": "Vafler\n\nIngredienser\n4 egg\n\nSlik gjør du\nStek."})

    assert response.status_code == 200
    assert response.json() == {
        "readable": True,
        "title": "Vafler",
        "ingredients": "4 egg",
        "instructions": "Stek.",
        "read_by": "rules",
        "notice": importer.RULES_READER_OFF,
    }
    assert Recipe.objects.count() == 0
