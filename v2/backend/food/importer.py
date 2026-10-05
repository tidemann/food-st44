"""Import a recipe from a link or from pasted text, with no AI: a draft for the "Ny oppskrift"
form, like food.reader's. Nothing is saved; the editor checks the draft and saves it with
POST /api/recipes.

A link: `fetch` gets the page, guarded against SSRF (http/https on the usual ports, public
addresses only, every redirect checked again, a deadline and a size limit), and `from_html`
reads its schema.org Recipe data (JSON-LD), or the page's visible text when that data has no
ingredients or steps. Text: `split_text` splits it into title, ingredients and instructions by
simple rules.
"""

import html
import ipaddress
import json
import re
import socket
import ssl
import time
import zlib
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from html.parser import HTMLParser
from http.client import HTTPConnection, HTTPException, HTTPResponse
from urllib.parse import SplitResult, urljoin, urlsplit

from django.conf import settings

from food.reader import UNREADABLE, Draft

BAD_URL = "Skriv inn hele lenken til oppskriften, for eksempel https://www.matprat.no/…"
NOT_ALLOWED = "Den lenken kan vi ikke hente fra. Bruk lenken til en oppskrift på nettet."
UNKNOWN_HOST = "Fant ikke nettstedet. Sjekk at lenken er riktig."
NOT_FOUND = "Siden finnes ikke. Sjekk at lenken er riktig."
NOT_FETCHED = (
    "Nettstedet ville ikke gi oss siden. Noen nettsteder stenger ute alt som ikke er en "
    "nettleser. Lim inn teksten i stedet, eller skriv inn oppskriften selv."
)
TIMED_OUT = "Det tok for lang tid å hente siden. Prøv igjen, eller skriv inn oppskriften selv."
TOO_LARGE = "Siden er for stor til å lese. Lim inn teksten i stedet, eller skriv den inn selv."
NO_TEXT = "Lim inn teksten til oppskriften."
TEXT_TOO_LONG = "Teksten er for lang. Lim inn bare én oppskrift."

# The ports a recipe site is on. Anything else is refused, so the server cannot be used to probe
# ports on other machines. A test may widen it.
ALLOWED_PORTS = frozenset({80, 443})
MAX_REDIRECTS = 5
# NAT64's well-known prefix: the last 32 bits are an IPv4 address, which is what gets reached.
NAT64 = ipaddress.IPv6Network("64:ff9b::/96")
TEXT_MAX_CHARS = 20_000

# Why pasted text was split by rules, not read by the AI provider (food.reader.read_text).
RULES_READER_OFF = "Lesing med KI er ikke slått på, så teksten er delt opp etter enkle regler."
RULES_FAILED = (
    "Tjenesten som leser teksten svarte ikke som den skulle, så teksten er delt opp etter "
    "enkle regler."
)
RULES_TIMED_OUT = (
    "Det tok for lang tid å lese teksten med KI, så den er delt opp etter enkle regler."
)
USER_AGENT = "Mozilla/5.0 (compatible; food.st44.no recipe import; +https://food.st44.no)"


class NotAllowed(Exception):
    """The link itself is refused: not http(s), a port we do not fetch, or a name that points
    at a private, loopback or otherwise non-public address."""


class FetchError(Exception):
    """The page could not be fetched: no such host, refused, an HTTP error, too slow or too
    large. The message is what the editor is told."""

    def __init__(self, message: str, *, timed_out: bool = False) -> None:
        super().__init__(message)
        self.timed_out = timed_out


# --- the link ---


def check_url(url: str) -> SplitResult:
    """The link split up, or NotAllowed. Says nothing about where the name points."""
    try:
        parts = urlsplit(url.strip())
        port = parts.port
    except ValueError as exc:
        raise NotAllowed(BAD_URL) from exc
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise NotAllowed(BAD_URL)
    if parts.username is not None or parts.password is not None:
        raise NotAllowed(NOT_ALLOWED)
    if (port or default_port(parts)) not in ALLOWED_PORTS:
        raise NotAllowed(NOT_ALLOWED)
    return parts


def default_port(parts: SplitResult) -> int:
    return 443 if parts.scheme == "https" else 80


def is_public(address: str) -> bool:
    """True for an address on the public internet. Private, loopback, link-local (the cloud
    metadata service at 169.254.169.254), shared, reserved and multicast addresses are not."""
    ip = ipaddress.ip_address(address.split("%", 1)[0])  # an IPv6 zone id is never public
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    elif isinstance(ip, ipaddress.IPv6Address) and ip in NAT64:
        ip = ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
    return ip.is_global and not ip.is_multicast


def resolve(host: str, port: int) -> str:
    """The address to connect to. Every address the name has must be public, so a name with
    one public and one private address is refused too."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (OSError, UnicodeError) as exc:
        raise FetchError(UNKNOWN_HOST) from exc
    addresses = [str(info[4][0]) for info in infos]
    if not addresses:
        raise FetchError(UNKNOWN_HOST)
    if not all(is_public(address) for address in addresses):
        raise NotAllowed(NOT_ALLOWED)
    return addresses[0]


class _PinnedConnection(HTTPConnection):
    """Connects to the address `resolve` checked, never to a second lookup of the name (which
    could answer differently: DNS rebinding), and speaks TLS for the name when asked to."""

    def __init__(
        self, host: str, port: int, address: str, timeout: float, tls: ssl.SSLContext | None
    ) -> None:
        super().__init__(host, port, timeout=timeout)
        self.address = address
        self.tls = tls

    def connect(self) -> None:
        sock = socket.create_connection((self.address, self.port), self.timeout)
        self.sock = self.tls.wrap_socket(sock, server_hostname=self.host) if self.tls else sock


@dataclass(frozen=True)
class Page:
    url: str  # where it ended up, after redirects
    html: str


def fetch(url: str) -> Page:
    """GET the page, following redirects and checking each one. NotAllowed for a link we will
    not fetch, FetchError when it could not be fetched."""
    deadline = time.monotonic() + settings.FOOD_IMPORT_TIMEOUT
    for _ in range(MAX_REDIRECTS + 1):
        parts = check_url(url)
        host = parts.hostname or ""
        port = parts.port or default_port(parts)
        address = resolve(host, port)
        tls = ssl.create_default_context() if parts.scheme == "https" else None
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise FetchError(TIMED_OUT, timed_out=True)
        connection = _PinnedConnection(host, port, address, remaining, tls)
        try:
            response = _get(connection, parts)
            location = response.getheader("Location")
            if response.status in (301, 302, 303, 307, 308) and location:
                url = urljoin(url, location.strip())
                continue
            if response.status == 404 or response.status == 410:
                raise FetchError(NOT_FOUND)
            if response.status != 200:
                raise FetchError(NOT_FETCHED)
            return Page(url, _body(response, connection, deadline))
        except TimeoutError as exc:
            raise FetchError(TIMED_OUT, timed_out=True) from exc
        except (OSError, HTTPException) as exc:
            raise FetchError(NOT_FETCHED) from exc
        finally:
            connection.close()
    raise FetchError(NOT_FETCHED)


def _get(connection: HTTPConnection, parts: SplitResult) -> HTTPResponse:
    host = (parts.hostname or "").encode("idna").decode()
    if ":" in host:
        host = f"[{host}]"
    if parts.port:
        host += f":{parts.port}"
    path = parts.path or "/"
    if parts.query:
        path += "?" + parts.query
    connection.request(
        "GET",
        path,
        headers={
            "Host": host,
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "nb,no;q=0.9,en;q=0.5",
            "Accept-Encoding": "gzip, deflate",
        },
    )
    return connection.getresponse()


def _body(response: HTTPResponse, connection: HTTPConnection, deadline: float) -> str:
    """The page as text, read within the deadline and the size limit (after decompression)."""
    limit = settings.FOOD_IMPORT_MAX_BYTES
    encoding = (response.getheader("Content-Encoding") or "").strip().lower()
    # 16 + MAX_WBITS takes a gzip header; 32 + MAX_WBITS also zlib, which "deflate" mostly is.
    inflate = zlib.decompressobj(32 + zlib.MAX_WBITS) if encoding in ("gzip", "deflate") else None
    chunks: list[bytes] = []
    size = 0
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise FetchError(TIMED_OUT, timed_out=True)
        if connection.sock is not None:
            connection.sock.settimeout(remaining)
        # read1: what one receive brings, so a site that drips its page meets the deadline.
        chunk = response.read1(65536)
        if not chunk:
            if inflate is None:
                break
            chunk, inflate = inflate.flush(), None
        if inflate is not None:
            try:
                chunk = inflate.decompress(chunk, limit + 1 - size)
            except zlib.error as exc:
                raise FetchError(NOT_FETCHED) from exc
        size += len(chunk)
        if size > limit:
            raise FetchError(TOO_LARGE)
        chunks.append(chunk)
    charset = response.headers.get_content_charset() or "utf-8"
    try:
        return b"".join(chunks).decode(charset, errors="replace")
    except LookupError:
        return b"".join(chunks).decode("utf-8", errors="replace")


def import_link(url: str) -> Draft:
    """The recipe on the page, or UNREADABLE when it has no recipe data we can read."""
    return from_html(fetch(url).html)


# --- schema.org Recipe in JSON-LD ---


class _JsonLdScripts(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.blocks: list[str] = []
        self._current: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "script":
            return
        kind = dict(attrs).get("type") or ""
        if kind.split(";")[0].strip().lower() == "application/ld+json":
            self._current = []

    def handle_data(self, data: str) -> None:
        if self._current is not None:
            self._current.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._current is not None:
            self.blocks.append("".join(self._current))
            self._current = None


def _is_recipe(node: dict[str, object]) -> bool:
    kinds = node.get("@type")
    for kind in kinds if isinstance(kinds, list) else [kinds]:
        # "Recipe", "schema:Recipe" or "https://schema.org/Recipe".
        if isinstance(kind, str) and re.split(r"[/:]", kind)[-1] == "Recipe":
            return True
    return False


def _recipes(node: object) -> Iterator[dict[str, object]]:
    """Every Recipe object in a JSON-LD document: at the top, in a list, or in an @graph (or a
    page's mainEntity)."""
    if isinstance(node, list):
        for item in node:
            yield from _recipes(item)
    elif isinstance(node, dict):
        if _is_recipe(node):
            yield node
        for key in ("@graph", "mainEntity"):
            if key in node:
                yield from _recipes(node[key])


_TAG = re.compile(r"<[^>]*>")
_BREAK = re.compile(r"<\s*(br|/p|/li|/div|/h\d)\b[^>]*>", re.IGNORECASE)


def _text_lines(value: str) -> list[str]:
    """A JSON-LD string as plain lines: some sites put HTML (and its entities) in it."""
    value = _TAG.sub(" ", _BREAK.sub("\n", value))
    lines = (" ".join(html.unescape(line).split()) for line in value.splitlines())
    return [line for line in lines if line]


def _one_line(value: object) -> str:
    return " ".join(_text_lines(value)) if isinstance(value, str) else ""


def _ingredients(value: object) -> list[str]:
    items = value if isinstance(value, list) else [value]
    return [line for item in items if isinstance(item, str) for line in _text_lines(item)]


def _steps(value: object) -> list[str]:
    """recipeInstructions in any of its shapes: one string, a list of strings, a list of
    HowToStep, or HowToSections of HowToSteps."""
    if isinstance(value, str):
        return _text_lines(value)
    if isinstance(value, list):
        return [step for item in value for step in _steps(item)]
    if isinstance(value, dict):
        if "itemListElement" in value:  # a HowToSection, or an ItemList
            return _steps(value["itemListElement"])
        text = value.get("text") or value.get("name")
        return _steps(text) if isinstance(text, str) else []
    return []


# Lines some sites add to their own steps to sell something: "Bli abonnent på aperitif +",
# "Lag din egen personlige kokebok …", "Få dagens rett som nyhetsbrev". No real step says these.
_PROMOTION = re.compile(
    r"\b(?:abonnent|abonner|nyhetsbrev|personlige? kokebok|newsletter|subscribe|subscription)",
    re.IGNORECASE,
)


def _without_promotion(steps: list[str]) -> list[str]:
    return [step for step in steps if not _PROMOTION.search(step)]


def from_html(page: str) -> Draft:
    """The first schema.org Recipe in the page's JSON-LD that has ingredients or steps. When
    there is none, the recipe is read from the page's visible text (`from_page_text`), titled
    with the JSON-LD name if there was one. UNREADABLE when neither has ingredients or steps."""
    parser = _JsonLdScripts()
    parser.feed(page)
    parser.close()
    title = ""
    for block in parser.blocks:
        try:
            # strict=False: raw newlines inside strings are common and harmless.
            data = json.loads(block, strict=False)
        except ValueError:
            continue
        for recipe in _recipes(data):
            ingredients = recipe.get("recipeIngredient", recipe.get("ingredients"))
            draft = Draft(
                title=_one_line(recipe.get("name")),
                ingredients="\n".join(_ingredients(ingredients)),
                instructions="\n".join(
                    _without_promotion(_steps(recipe.get("recipeInstructions")))
                ),
            )
            if draft.ingredients or draft.instructions:
                return draft
            title = title or draft.title
    return from_page_text(page, title)


# --- the page's visible text, when its JSON-LD has no recipe in it ---

# Left out with everything in them: not the recipe.
_HIDDEN = frozenset(
    {"head", "script", "style", "noscript", "template", "svg", "nav", "footer", "aside", "form"}
    | {"button", "select", "iframe"}
)
_BLOCK = frozenset(
    {"p", "div", "li", "ul", "ol", "dl", "dt", "dd", "br", "tr", "td", "th", "table", "pre"}
    | {"section", "article", "main", "header", "blockquote", "figure", "figcaption"}
    | {"h1", "h2", "h3", "h4", "h5", "h6"}
)


class _PageText(HTMLParser):
    """The visible text of a page, one line per block (paragraph, list item, heading), each
    with its heading level (0 when it is not a heading) and whether it is inside <main>."""

    def __init__(self) -> None:
        super().__init__()
        self.lines: list[tuple[str, int, bool]] = []
        self._parts: list[str] = []
        self._hidden = 0
        self._main = 0
        self._level = 0

    def _flush(self) -> None:
        text = " ".join("".join(self._parts).split())
        if text:
            self.lines.append((text, self._level, self._main > 0))
        self._parts = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _HIDDEN:
            self._hidden += 1
        elif tag in _BLOCK:
            self._flush()
            self._main += tag == "main"
            if tag[0] == "h" and tag[1:].isdigit():
                self._level = int(tag[1:])

    def handle_endtag(self, tag: str) -> None:
        if tag in _HIDDEN:
            self._hidden = max(self._hidden - 1, 0)
        elif tag in _BLOCK:
            self._flush()
            self._main = max(self._main - (tag == "main"), 0)
            if tag[0] == "h" and tag[1:].isdigit():
                self._level = 0

    def handle_data(self, data: str) -> None:
        if not self._hidden:
            self._parts.append(data)


def from_page_text(page: str, title: str = "") -> Draft:
    """The recipe in the page's visible text (inside <main> when the page has one), split by
    `split_text`. Only a page with an "Ingredients" or "Directions" style heading is read, and
    the text stops at the next heading at the level of the directions heading or above, so the
    comments and "other recipes" below it are left out. No AI. UNREADABLE when there are no
    ingredients and no steps."""
    parser = _PageText()
    parser.feed(page)
    parser.close()
    lines = [(text, level) for text, level, main in parser.lines if main] or [
        (text, level) for text, level, _ in parser.lines
    ]
    texts = [text for text, _ in lines]
    steps_at = _first(texts, lambda text: _heading(text, _INSTRUCTION_HEADS))
    if steps_at is None and _first(texts, lambda text: _heading(text, _INGREDIENT_HEADS)) is None:
        return UNREADABLE
    if steps_at is not None:
        # A directions heading that is not a heading tag (bold text) ends at any heading tag.
        limit = lines[steps_at][1] or 6
        end = next(
            (i for i in range(steps_at + 1, len(lines)) if 0 < lines[i][1] <= limit), len(lines)
        )
        lines = lines[:end]
    if not title:
        title = next((text for text, level in lines if level == 1), "")
    body = [text for text, _ in lines if text != title]
    draft = split_text("\n".join([title, *body]))
    if not (draft.ingredients or draft.instructions):
        return UNREADABLE
    steps = _without_promotion(draft.instructions.splitlines())
    return Draft(draft.title, draft.ingredients, "\n".join(steps))


# --- pasted text ---

_INGREDIENT_HEADS = (
    "ingredienser",
    "ingrediens",
    "ingredients",
    "du trenger",
    "dette trenger du",
    "handleliste",
)
_INSTRUCTION_HEADS = (
    "fremgangsmåte",
    "framgangsmåte",
    "slik gjør du",
    "slik gjør du det",
    "gjør slik",
    "tilberedning",
    "instruksjoner",
    "instructions",
    "method",
    "directions",
    "preparation",
    "steps",
)
_MARKUP = re.compile(r"^[#*_\s]+|[*_\s:]+$")
# "-", "*", "•", "·", en and em dash, small squares and circles, and "[ ]" checkboxes.
_BULLET = re.compile("^(?:[-*\\u2022\\u00b7\\u2013\\u2014\\u25aa\\u25e6]|\\[[ xX]?\\])\\s*")
_NUMBERED = re.compile(r"^(?:\d{1,2}\s*[.)]|(?:steg|step|trinn)\s*\d{1,2}\s*[.:)]?)\s+", re.I)
# A number or a fraction first; "en klype salt" passes as a short line instead.
_AMOUNT = re.compile(r"^(?:ca\.?\s*)?[\d½¼¾⅓⅔⅛]", re.I)
_YIELD = re.compile(r"\b(?:porsjon(?:er)?|personer|serves|servings|stk\.? kaker)\b", re.I)


def _heading(line: str, heads: tuple[str, ...]) -> bool:
    """ "Ingredienser", "## Fremgangsmåte:", "Ingredienser (4 porsjoner)" and the like."""
    words = _MARKUP.sub("", line).lower()
    words = re.sub(r"\s*\(.*\)$", "", words)
    words = " ".join(words.split())
    if len(words) > 40:
        return False
    return any(words == head or words.startswith(head + " ") for head in heads)


def _looks_like_ingredient(line: str) -> bool:
    """An amount first, a bullet, or a short line that is not a sentence ("Salt og pepper")."""
    if _NUMBERED.match(line):
        return False
    if _BULLET.match(line) or _AMOUNT.match(line):
        return len(line) <= 80
    sentence = line.endswith((".", "!", "?")) or re.search(r"[.!?] ", line)
    return len(line) <= 45 and not sentence


def _ingredient_lines(lines: list[str]) -> list[str]:
    found = (_BULLET.sub("", line).strip() for line in lines)
    return [line for line in found if line and not (_YIELD.search(line) and len(line) <= 30)]


def _instruction_lines(lines: list[str]) -> list[str]:
    """One step per line. A step wrapped over several lines (paragraphs with blank lines between
    them) is joined back into one; numbered or bulleted lines stay steps of their own."""
    blocks: list[list[str]] = [[]]
    for line in lines:
        if line:
            blocks[-1].append(line)
        elif blocks[-1]:
            blocks.append([])
    blocks = [block for block in blocks if block]
    steps: list[str] = []
    for block in blocks:
        marked = any(_NUMBERED.match(line) or _BULLET.match(line) for line in block)
        if len(blocks) > 1 and not marked:
            block = [" ".join(block)]
        for line in block:
            step = _NUMBERED.sub("", _BULLET.sub("", line)).strip()
            if step:
                steps.append(step)
    return steps


def _first(lines: list[str], test: Callable[[str], bool]) -> int | None:
    return next((i for i, line in enumerate(lines) if test(line)), None)


def split_text(text: str) -> Draft:
    """Split a recipe pasted from another app into title, ingredients and instructions.

    The first line is the title. Headings like "Ingredienser" and "Fremgangsmåte" mark the
    parts when they are there. Without them, the ingredients are the lines after the title that
    look like ingredients (an amount first, a bullet, or short), and the rest is instructions.
    """
    lines = [" ".join(line.split()) for line in text.splitlines()]
    while lines and not lines[0]:
        lines.pop(0)
    if not lines:
        return UNREADABLE
    title = ""
    if not _heading(lines[0], _INGREDIENT_HEADS + _INSTRUCTION_HEADS):
        title = _BULLET.sub("", _MARKUP.sub("", lines.pop(0)))

    ingredients_at = _first(lines, lambda line: _heading(line, _INGREDIENT_HEADS))
    steps_at = _first(lines, lambda line: _heading(line, _INSTRUCTION_HEADS))
    if ingredients_at is not None:
        start = ingredients_at + 1
    else:
        # No heading: they start at the first line that looks like one (an intro is skipped).
        start = _first(lines, lambda line: bool(line) and _looks_like_ingredient(line)) or 0
    if steps_at is not None and start <= steps_at:
        ingredients = lines[start:steps_at]
        steps = lines[steps_at + 1 :]
    else:
        # No instructions heading: the ingredients are the run of ingredient-like lines, and
        # the instructions are the rest.
        end = start
        while end < len(lines) and (not lines[end] or _looks_like_ingredient(lines[end])):
            end += 1
        ingredients = lines[start:end]
        steps = [line for line in lines[end:] if not _heading(line, _INSTRUCTION_HEADS)]
    draft = Draft(
        title=title,
        ingredients="\n".join(_ingredient_lines(ingredients)),
        instructions="\n".join(_instruction_lines(steps)),
    )
    return draft if draft.readable else UNREADABLE
