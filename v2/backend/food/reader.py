"""Read a recipe from a photo of a paper recipe: a draft for the "Ny oppskrift" form.

One interface, `RecipeReader`, and a provider chosen by settings only (FOOD_AI_PROVIDER, see
config.settings): `off`, `fake`, or `openai_compatible` for any chat API that takes images the
way OpenAI's does. Nothing is saved but a PhotoRead row (who, when, which provider, how it went)
for the admin's count: not the draft, and never the photo, which only goes to the provider.
"""

import base64
import json
import logging
import re
from dataclasses import dataclass
from io import BytesIO
from typing import IO, Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

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


class ReaderOff(Exception):
    """FOOD_AI_PROVIDER is off, or openai_compatible without a base URL and a model."""


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

    def read(self, jpeg: bytes) -> Draft:
        """The recipe in the photo, or UNREADABLE. ProviderError if the provider failed."""
        ...


class FakeReader:
    """No network, no cost: always the same recipe, so tests and a local demo can run the whole
    flow. A photo of one plain colour (nothing on it) gives UNREADABLE, to show that screen."""

    name = "fake"
    model = ""

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


class OpenAICompatibleReader:
    """POST {base_url}/chat/completions with the photo as a data: URL. Works with OpenAI and
    with anything that copies its API: Azure, OpenRouter, a gateway, or a local model behind
    Ollama, vLLM or llama.cpp."""

    name = "openai_compatible"

    def __init__(self, base_url: str, model: str, api_key: str, timeout: float) -> None:
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.model = model
        self.api_key = api_key
        self.timeout = timeout

    def read(self, jpeg: bytes) -> Draft:
        image_url = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Read the recipe in this photo as JSON."},
                        {"type": "image_url", "image_url": {"url": image_url}},
                    ],
                },
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
    outcome = PhotoRead.Outcome.FAILED
    try:
        draft = reader.read(jpeg)
        outcome = PhotoRead.Outcome.READ if draft.readable else PhotoRead.Outcome.UNREADABLE
        return draft
    except ProviderError as exc:
        log.warning("reading a recipe photo with %s failed: %s", reader.name, exc)
        raise
    finally:
        PhotoRead.objects.create(
            editor=editor, provider=reader.name, model=reader.model, outcome=outcome
        )
