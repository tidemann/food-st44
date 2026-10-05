"""Read a recipe from a photo of a paper recipe, or from pasted text (M5): a draft for the
"Ny oppskrift" form.

One interface, `RecipeReader`, and a provider chosen by settings only (FOOD_AI_PROVIDER, see
config.settings): `off`, `fake`, `anthropic` for Claude through Anthropic's own Messages API,
or `openai_compatible` for any chat API that takes images the way OpenAI's does. Nothing is
saved but a PhotoRead row (who, when, photo or text, which provider, how it went) for the
admin's count: not the draft, and never the photo or the text, which only go to the provider.
"""

import base64
import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from io import BytesIO
from typing import IO, Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import anthropic
from django.conf import settings
from PIL import Image

from food import photos
from food.models import PhotoRead

log = logging.getLogger(__name__)

OFF = "Lesing av oppskrift fra bilde er ikke slått på."
TIMED_OUT = "Det tok for lang tid å lese bildet. Prøv igjen, eller skriv inn oppskriften selv."
FAILED = (
    "Tjenesten som leser bildet svarte ikke som den skulle. Prøv igjen om litt, "
    "eller skriv inn oppskriften selv."
)

PROMPT = """\
The image is a photo of a recipe: a cookbook page, a printout, a card or a handwritten note.
Copy the recipe's text exactly as written, in its own language. Do not translate it, do not
add anything that is not on the page, and do not guess at text you cannot read.
Answer with one JSON object and nothing else:
{"readable": true, "title": "...", "ingredients": ["one line per ingredient, amount first"],
 "instructions": ["one string per step or paragraph"]}
If the image holds no recipe, or too little of it can be read, answer {"readable": false}.
"""

TEXT_PROMPT = """\
The user's message is a recipe pasted as plain text from another app, an e-mail or a document.
Split it into the recipe's title, ingredients and instructions. Keep the recipe's own words and
language: do not translate, do not rewrite, and do not add anything that is not in the text.
Leave out what is not part of the recipe (ads, comments, links, nutrition tables).
Answer with one JSON object and nothing else:
{"readable": true, "title": "...", "ingredients": ["one line per ingredient, amount first"],
 "instructions": ["one string per step or paragraph"]}
If the text holds no recipe, answer {"readable": false}.
"""


class ReaderOff(Exception):
    """FOOD_AI_PROVIDER is off, anthropic without a key, or openai_compatible without a base URL
    and a model."""


class ProviderError(Exception):
    """The provider could not be reached, refused the request, timed out or sent nonsense."""

    def __init__(self, message: str, *, timed_out: bool = False) -> None:
        super().__init__(message)
        self.timed_out = timed_out


@dataclass(frozen=True)
class Draft:
    """What the form gets: the same fields as RecipeIn. All empty when the photo could not be
    read."""

    title: str = ""
    ingredients: str = ""  # newline-separated, like Recipe.ingredients
    instructions: str = ""

    @property
    def readable(self) -> bool:
        return bool(self.title or self.ingredients)


UNREADABLE = Draft()


class RecipeReader(Protocol):
    name: str
    model: str
    cost: str  # what one photo costs, for the admin when FOOD_AI_COST_PER_PHOTO is not set

    def read(self, jpeg: bytes) -> Draft:
        """The recipe in the photo, or UNREADABLE. ProviderError if the provider failed."""
        ...

    def read_text(self, text: str) -> Draft:
        """The recipe in pasted text, or UNREADABLE. ProviderError if the provider failed."""
        ...


class FakeReader:
    """No network, no cost: always the same recipe, so tests and a local demo can run the whole
    flow. A photo of one plain colour (nothing on it), or text of a single line, gives
    UNREADABLE, to show that screen."""

    name = "fake"
    model = ""
    cost = "0 (testleverandør)"

    DRAFT = Draft(
        title="Sveler",
        ingredients="2 egg\n1 dl sukker\n5 dl kulturmelk\n1 ts natron\n4 dl hvetemel\n50 g smør",
        instructions=(
            "Visp egg og sukker luftig.\n"
            "Rør inn kulturmelk, natron og mel, og la røren svelle i 15 minutter.\n"
            "Smelt smøret og rør det inn.\n"
            "Stek svelene i middels varm panne til de er gylne på begge sider."
        ),
    )

    def read(self, jpeg: bytes) -> Draft:
        with Image.open(BytesIO(jpeg)) as image:
            histogram = image.convert("L").histogram()
        shades = [shade for shade, count in enumerate(histogram) if count]
        return UNREADABLE if shades[-1] - shades[0] < 8 else self.DRAFT

    def read_text(self, text: str) -> Draft:
        lines = [line for line in text.splitlines() if line.strip()]
        return UNREADABLE if len(lines) < 2 else self.DRAFT


class OpenAICompatibleReader:
    """POST {base_url}/chat/completions with the photo as a data: URL. Works with OpenAI and
    with anything that copies its API: Azure, OpenRouter, a gateway, or a local model behind
    Ollama, vLLM or llama.cpp."""

    name = "openai_compatible"
    cost = ""  # depends on the service and the model; FOOD_AI_COST_PER_PHOTO says it

    def __init__(self, base_url: str, model: str, api_key: str, timeout: float) -> None:
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.model = model
        self.api_key = api_key
        self.timeout = timeout

    def read(self, jpeg: bytes) -> Draft:
        image_url = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()
        return self._ask(
            PROMPT,
            [
                {"type": "text", "text": "Read the recipe in this photo as JSON."},
                {"type": "image_url", "image_url": {"url": image_url}},
            ],
        )

    def read_text(self, text: str) -> Draft:
        return self._ask(TEXT_PROMPT, text)

    def _ask(self, system: str, content: object) -> Draft:
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": content},
            ],
            "response_format": {"type": "json_object"},
        }
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        # S310: get_reader only builds this reader for an http(s) base URL, never file: or ftp:.
        data = json.dumps(body).encode()
        request = Request(self.url, data=data, headers=headers, method="POST")  # noqa: S310
        try:
            with urlopen(request, timeout=self.timeout) as response:  # noqa: S310
                answer: Any = json.load(response)
        except TimeoutError as exc:
            raise ProviderError("timed out", timed_out=True) from exc
        except HTTPError as exc:
            raise ProviderError(f"HTTP {exc.code}") from exc
        except URLError as exc:
            if isinstance(exc.reason, TimeoutError):
                raise ProviderError("timed out", timed_out=True) from exc
            raise ProviderError(f"unreachable: {exc.reason}") from exc
        except (OSError, ValueError) as exc:
            raise ProviderError(f"bad response: {exc}") from exc
        try:
            content = answer["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError("no message in the response") from exc
        if not isinstance(content, str):
            raise ProviderError("the message is not text")
        return parse(content)


class AnthropicReader:
    """Claude through Anthropic's Messages API (the official SDK), the photo as a base64 image
    block. One try only, within the timeout: the SDK's retries would take the editor past 30 s."""

    name = "anthropic"
    DEFAULT_MODEL = "claude-haiku-4-5"
    # Haiku 4.5 at $1 / $5 per million input / output tokens: a photo is at most ~1,600 image
    # tokens plus the prompt, and a recipe up to ~1,000 tokens of JSON back.
    DEFAULT_COST = "ca. $0.007 per bilde (Claude Haiku 4.5)"
    MAX_TOKENS = 4096  # a long recipe as JSON fits easily; a cut-off answer is a ProviderError

    def __init__(self, model: str, api_key: str, timeout: float) -> None:
        self.model = model or self.DEFAULT_MODEL
        self.cost = self.DEFAULT_COST if self.model == self.DEFAULT_MODEL else ""
        self.api_key = api_key
        self.timeout = timeout

    def read(self, jpeg: bytes) -> Draft:
        return self._ask(
            PROMPT,
            [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": base64.standard_b64encode(jpeg).decode(),
                    },
                },
                {"type": "text", "text": "Read the recipe in this photo as JSON."},
            ],
        )

    def read_text(self, text: str) -> Draft:
        return self._ask(TEXT_PROMPT, [{"type": "text", "text": text}])

    def _ask(self, system: str, content: list[anthropic.types.ContentBlockParam]) -> Draft:
        # Made here, not in __init__: get_reader runs on every "is the button on?" request.
        client = anthropic.Anthropic(api_key=self.api_key, timeout=self.timeout, max_retries=0)
        try:
            message = client.messages.create(
                model=self.model,
                max_tokens=self.MAX_TOKENS,
                system=system,
                messages=[{"role": "user", "content": content}],
            )
        except anthropic.APITimeoutError as exc:  # before APIConnectionError: a subclass of it
            raise ProviderError("timed out", timed_out=True) from exc
        except anthropic.APIStatusError as exc:
            raise ProviderError(f"HTTP {exc.status_code}") from exc
        except anthropic.APIConnectionError as exc:
            raise ProviderError(f"unreachable: {exc}") from exc
        if message.stop_reason not in ("end_turn", "stop_sequence"):
            raise ProviderError(f"stopped early: {message.stop_reason}")
        return parse("".join(block.text for block in message.content if block.type == "text"))


_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL)


def _lines(value: object) -> str:
    """A list of strings, or one string, as newline-separated lines without blank ones."""
    items = value if isinstance(value, list) else [value]
    lines: list[str] = []
    for item in items:
        if isinstance(item, str):
            lines.extend(line.strip() for line in item.splitlines())
    return "\n".join(line for line in lines if line)


def parse(content: str) -> Draft:
    """The model's answer as a Draft. A model that wraps its JSON in a ``` fence is forgiven;
    one that answers with no JSON object at all failed."""
    fenced = _FENCE.match(content)
    try:
        data = json.loads(fenced.group(1) if fenced else content)
    except ValueError as exc:
        raise ProviderError("the answer is not JSON") from exc
    if not isinstance(data, dict):
        raise ProviderError("the answer is not a JSON object")
    if data.get("readable") is False:
        return UNREADABLE
    title = data.get("title")
    draft = Draft(
        title=" ".join(title.split()) if isinstance(title, str) else "",
        ingredients=_lines(data.get("ingredients")),
        instructions=_lines(data.get("instructions")),
    )
    return draft if draft.readable else UNREADABLE


def get_reader() -> RecipeReader | None:
    """The reader the settings choose, or None when reading is off."""
    provider = settings.FOOD_AI_PROVIDER.strip().lower()
    if provider == "fake":
        return FakeReader()
    if provider == "anthropic":
        api_key = settings.FOOD_AI_API_KEY.strip()
        if not api_key:
            return None
        return AnthropicReader(settings.FOOD_AI_MODEL.strip(), api_key, settings.FOOD_AI_TIMEOUT)
    if provider == "openai_compatible":
        base_url = settings.FOOD_AI_BASE_URL.strip()
        model = settings.FOOD_AI_MODEL.strip()
        if not model or not base_url.startswith(("https://", "http://")):
            return None
        return OpenAICompatibleReader(
            base_url, model, settings.FOOD_AI_API_KEY.strip(), settings.FOOD_AI_TIMEOUT
        )
    return None  # "off", empty, or a name we do not know


def available() -> bool:
    return get_reader() is not None


def read_photo(source: IO[bytes], editor: str) -> Draft:
    """Read the recipe in an uploaded photo. ReaderOff when reading is off, photos.PhotoError
    when the file is not an image we take, ProviderError when the provider failed."""
    reader = get_reader()
    if reader is None:
        raise ReaderOff(OFF)
    jpeg = photos.for_reading(source)
    return _counted(reader, PhotoRead.Kind.PHOTO, editor, lambda: reader.read(jpeg))


def read_text(text: str, editor: str) -> Draft:
    """Read the recipe in pasted text (M5, "Lim inn tekst"). ReaderOff when reading is off,
    ProviderError when the provider failed: the caller then splits the text by rules."""
    reader = get_reader()
    if reader is None:
        raise ReaderOff(OFF)
    return _counted(reader, PhotoRead.Kind.TEXT, editor, lambda: reader.read_text(text))


def _counted(
    reader: RecipeReader, kind: PhotoRead.Kind, editor: str, read: Callable[[], Draft]
) -> Draft:
    """One read sent to the provider, counted for the admin however it went."""
    outcome = PhotoRead.Outcome.FAILED
    try:
        draft = read()
        outcome = PhotoRead.Outcome.READ if draft.readable else PhotoRead.Outcome.UNREADABLE
        return draft
    except ProviderError as exc:
        log.warning("reading a recipe %s with %s failed: %s", kind, reader.name, exc)
        raise
    finally:
        PhotoRead.objects.create(
            editor=editor, kind=kind, provider=reader.name, model=reader.model, outcome=outcome
        )
