import base64
import json
import threading
import time
from collections.abc import Iterator
from email.message import Message
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.error import HTTPError, URLError
from urllib.request import Request

import anthropic
import httpx2
import pytest
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client
from django.test.utils import override_settings
from PIL import Image, ImageDraw
from pytest_django import Settings

from food import photos, reader
from food.models import Editor, PhotoRead, Recipe

if TYPE_CHECKING:
    from django.test.client import _MonkeyPatchedWSGIResponse as Response

pytestmark = pytest.mark.django_db

URL = "/api/recipes/read-photo"
BASE_URL = "https://ai.example.com/v1"


@pytest.fixture(autouse=True)
def isolated(settings: Settings, tmp_path: Path) -> Iterator[Path]:
    """Reading off, as in production, until a test switches it on; photos in a fresh dir."""
    settings.FOOD_AI_PROVIDER = "off"
    settings.FOOD_AI_BASE_URL = ""
    settings.FOOD_AI_MODEL = ""
    settings.FOOD_AI_API_KEY = ""
    settings.FOOD_AI_TIMEOUT = 25.0
    settings.FOOD_AI_COST_PER_PHOTO = ""
    settings.FOOD_ADMIN_EMAILS = ["stig@example.com"]
    with override_settings(PHOTOS_DIR=tmp_path / "photos"):
        yield tmp_path


def sign_in_as(client: Client, email: str, *, editor: bool = True) -> User:
    user = User.objects.create(username=f"google:{email}", email=email)
    if editor:
        Editor.objects.create(email=email)
    client.force_login(user)
    return user


@pytest.fixture
def editor(client: Client) -> User:
    return sign_in_as(client, "editor@example.com")


def recipe_photo(fmt: str = "JPEG", *, blank: bool = False) -> bytes:
    """A stand-in for a photographed page: some dark "text" on paper, or nothing at all."""
    picture = Image.new("RGB", (600, 800), (251, 250, 247))
    if not blank:
        ImageDraw.Draw(picture).rectangle((60, 60, 540, 120), fill=(20, 17, 14))
    out = BytesIO()
    picture.save(out, fmt)
    return out.getvalue()


def read(client: Client, data: bytes, name: str = "IMG_0042.jpg") -> "Response":
    return client.post(URL, {"photo": SimpleUploadedFile(name, data)})


def available(client: Client) -> bool:
    response = client.get(URL)
    assert response.status_code == 200
    value: bool = response.json()["available"]
    return value


class FakeProvider:
    """Stands in for urlopen on an OpenAI-compatible endpoint and records what it was sent."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.answer: object = {
            "readable": True,
            "title": " Mormors  kjøttkaker ",
            "ingredients": ["600 g kjøttdeig", "1 ts salt", " ", "1 egg"],
            "instructions": ["Bland alt.", "Form kakene og stek dem."],
        }
        self.content: str | None = None  # the raw message content, when set
        self.error: Exception | None = None
        self.request: Request | None = None
        self.timeout: float | None = None
        monkeypatch.setattr("food.reader.urlopen", self)

    def __call__(self, request: Request, timeout: float) -> BytesIO:
        self.request, self.timeout = request, timeout
        if self.error is not None:
            raise self.error
        content = self.content if self.content is not None else json.dumps(self.answer)
        body = {"choices": [{"message": {"role": "assistant", "content": content}}]}
        return BytesIO(json.dumps(body).encode())

    def sent(self) -> dict[str, Any]:
        assert self.request is not None
        assert isinstance(self.request.data, bytes)
        body: dict[str, Any] = json.loads(self.request.data)
        return body


@pytest.fixture
def provider(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> FakeProvider:
    settings.FOOD_AI_PROVIDER = "openai_compatible"
    settings.FOOD_AI_BASE_URL = BASE_URL + "/"
    settings.FOOD_AI_MODEL = "vision-model-1"
    settings.FOOD_AI_API_KEY = "sk-test"
    return FakeProvider(monkeypatch)


# --- who may read: editors only ---


def test_anonymous_and_non_editors_get_403_and_no_button(
    client: Client, settings: Settings
) -> None:
    settings.FOOD_AI_PROVIDER = "fake"

    assert read(client, recipe_photo()).status_code == 403
    assert available(client) is False

    sign_in_as(client, "guest@example.com", editor=False)
    assert read(client, recipe_photo()).status_code == 403
    assert available(client) is False
    assert not PhotoRead.objects.exists()


def test_an_editor_gets_the_button_only_when_reading_is_on(
    client: Client, editor: User, settings: Settings
) -> None:
    assert available(client) is False
    settings.FOOD_AI_PROVIDER = "fake"
    assert available(client) is True


def test_off_answers_503_with_a_clear_message(client: Client, editor: User) -> None:
    response = read(client, recipe_photo())

    assert response.status_code == 503
    assert response.json() == {"detail": reader.OFF}
    assert not PhotoRead.objects.exists()


# --- the fake provider ---


def test_fake_fills_the_draft_and_saves_nothing_but_the_count(
    client: Client, editor: User, settings: Settings, isolated: Path
) -> None:
    settings.FOOD_AI_PROVIDER = "fake"

    response = read(client, recipe_photo())

    assert response.status_code == 200
    draft = response.json()
    assert draft == {
        "readable": True,
        "title": "Sveler",
        "ingredients": reader.FakeReader.DRAFT.ingredients,
        "instructions": reader.FakeReader.DRAFT.instructions,
    }
    assert "2 egg" in draft["ingredients"].splitlines()
    assert not Recipe.objects.exists()
    assert list(isolated.rglob("*")) == []  # the photo is not stored anywhere
    read_row = PhotoRead.objects.get()
    assert (read_row.editor, read_row.provider, read_row.outcome) == (
        "editor@example.com",
        "fake",
        PhotoRead.Outcome.READ,
    )


def test_the_draft_saves_as_a_recipe_unchanged(
    client: Client, editor: User, settings: Settings
) -> None:
    settings.FOOD_AI_PROVIDER = "fake"
    draft = read(client, recipe_photo()).json()
    draft.pop("readable")

    response = client.post("/api/recipes", draft, content_type="application/json")

    assert response.status_code == 201
    assert Recipe.objects.get().title == "Sveler"


def test_a_photo_with_nothing_on_it_could_not_be_read(
    client: Client, editor: User, settings: Settings
) -> None:
    settings.FOOD_AI_PROVIDER = "fake"

    response = read(client, recipe_photo(blank=True))

    assert response.status_code == 200
    assert response.json() == {
        "readable": False,
        "title": "",
        "ingredients": "",
        "instructions": "",
    }
    assert PhotoRead.objects.get().outcome == PhotoRead.Outcome.UNREADABLE


# --- bad files: the same checks and messages as a recipe photo ---


@pytest.mark.parametrize("fmt", ["PNG", "WEBP"])
def test_png_and_webp_are_read_too(
    client: Client, editor: User, settings: Settings, fmt: str
) -> None:
    settings.FOOD_AI_PROVIDER = "fake"
    assert read(client, recipe_photo(fmt), name=f"side.{fmt.lower()}").json()["readable"]


def test_not_an_image_is_422(client: Client, editor: User, settings: Settings) -> None:
    settings.FOOD_AI_PROVIDER = "fake"

    response = read(client, b"%PDF-1.7 not a photo", name="oppskrift.pdf")

    assert response.status_code == 422
    assert response.json() == {"errors": {"photo": photos.NOT_AN_IMAGE}}
    assert not PhotoRead.objects.exists()


def test_too_large_is_413(client: Client, editor: User, settings: Settings) -> None:
    settings.FOOD_AI_PROVIDER = "fake"
    settings.PHOTO_MAX_UPLOAD_BYTES = 1000

    response = read(client, recipe_photo())

    assert response.status_code == 413
    assert response.json() == {"errors": {"photo": photos.TOO_LARGE}}


def test_off_is_503_before_the_file_is_even_looked_at(client: Client, editor: User) -> None:
    assert read(client, b"not an image").status_code == 503


# --- an OpenAI-compatible provider ---


def test_openai_compatible_sends_the_photo_and_returns_the_draft(
    client: Client, editor: User, provider: FakeProvider
) -> None:
    response = read(client, recipe_photo("PNG"), name="side.png")

    assert response.status_code == 200
    assert response.json() == {
        "readable": True,
        "title": "Mormors kjøttkaker",
        "ingredients": "600 g kjøttdeig\n1 ts salt\n1 egg",
        "instructions": "Bland alt.\nForm kakene og stek dem.",
    }
    assert provider.request is not None
    assert provider.request.full_url == BASE_URL + "/chat/completions"
    assert provider.request.get_header("Authorization") == "Bearer sk-test"
    assert provider.timeout == 25.0
    sent = provider.sent()
    assert sent["model"] == "vision-model-1"
    image_url = sent["messages"][1]["content"][1]["image_url"]["url"]
    assert image_url.startswith("data:image/jpeg;base64,")
    jpeg = base64.b64decode(image_url.removeprefix("data:image/jpeg;base64,"))
    with Image.open(BytesIO(jpeg)) as image:
        assert (image.format, image.size) == ("JPEG", (600, 800))
        assert not image.getexif()
    read_row = PhotoRead.objects.get()
    assert (read_row.provider, read_row.model, read_row.outcome) == (
        "openai_compatible",
        "vision-model-1",
        PhotoRead.Outcome.READ,
    )


def test_a_local_model_needs_no_key(
    client: Client, editor: User, provider: FakeProvider, settings: Settings
) -> None:
    settings.FOOD_AI_API_KEY = ""
    settings.FOOD_AI_BASE_URL = "http://ollama:11434/v1"

    assert read(client, recipe_photo()).status_code == 200
    assert provider.request is not None
    assert provider.request.full_url == "http://ollama:11434/v1/chat/completions"
    assert provider.request.get_header("Authorization") is None


@pytest.mark.parametrize(
    "answer",
    [{"readable": False}, {"readable": True, "title": "", "ingredients": []}, {}],
)
def test_the_provider_finding_no_recipe_could_not_be_read(
    client: Client, editor: User, provider: FakeProvider, answer: object
) -> None:
    provider.answer = answer

    response = read(client, recipe_photo())

    assert response.status_code == 200
    assert response.json()["readable"] is False
    assert PhotoRead.objects.get().outcome == PhotoRead.Outcome.UNREADABLE


def test_a_fenced_answer_and_plain_text_fields_are_accepted(
    client: Client, editor: User, provider: FakeProvider
) -> None:
    provider.content = (
        '```json\n{"title": "Vafler", "ingredients": "4 egg\\n5 dl mel", '
        '"instructions": "Rør.\\n\\nStek."}\n```'
    )

    draft = read(client, recipe_photo()).json()

    assert draft["title"] == "Vafler"
    assert draft["ingredients"] == "4 egg\n5 dl mel"
    assert draft["instructions"] == "Rør.\nStek."


@pytest.mark.parametrize(
    ("error", "status", "message"),
    [
        (TimeoutError("timed out"), 504, reader.TIMED_OUT),
        (URLError(TimeoutError("timed out")), 504, reader.TIMED_OUT),
        (URLError(ConnectionRefusedError()), 502, reader.FAILED),
        (HTTPError(BASE_URL, 401, "Unauthorized", Message(), None), 502, reader.FAILED),
        (HTTPError(BASE_URL, 500, "Server Error", Message(), None), 502, reader.FAILED),
    ],
)
def test_a_provider_error_or_timeout_is_a_clear_answer(
    client: Client,
    editor: User,
    provider: FakeProvider,
    error: Exception,
    status: int,
    message: str,
) -> None:
    provider.error = error

    response = read(client, recipe_photo())

    assert response.status_code == status
    assert response.json() == {"detail": message}
    assert PhotoRead.objects.get().outcome == PhotoRead.Outcome.FAILED


@pytest.mark.parametrize("content", ["Here is the recipe: Vafler", "[1, 2]", None])
def test_an_answer_that_is_not_a_json_object_is_a_provider_error(
    client: Client, editor: User, provider: FakeProvider, content: str | None
) -> None:
    if content is None:
        provider.answer = None  # valid JSON content, but `null`
    else:
        provider.content = content

    assert read(client, recipe_photo()).status_code == 502


@pytest.mark.parametrize(
    ("base_url", "model"),
    [("", "vision-model-1"), (BASE_URL, ""), ("file:///etc/passwd", "vision-model-1")],
)
def test_openai_compatible_without_a_usable_url_and_model_is_off(
    client: Client,
    editor: User,
    provider: FakeProvider,
    settings: Settings,
    base_url: str,
    model: str,
) -> None:
    settings.FOOD_AI_BASE_URL = base_url
    settings.FOOD_AI_MODEL = model

    assert available(client) is False
    assert read(client, recipe_photo()).status_code == 503
    assert provider.request is None


# --- anthropic: Claude through the official SDK, the client mocked (no real calls) ---

ANTHROPIC_REQUEST = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


def anthropic_status(error: type[anthropic.APIStatusError], status: int) -> Exception:
    response = httpx2.Response(status, request=ANTHROPIC_REQUEST)
    return error(f"HTTP {status}", response=response, body=None)


class FakeAnthropic:
    """Stands in for anthropic.Anthropic: records the client options and the request, and
    answers with a real SDK Message, or raises a real SDK error."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.text = json.dumps(
            {
                "readable": True,
                "title": "Fiskeboller i hvit saus",
                "ingredients": ["1 boks fiskeboller", "2 ss smør", "2 ss hvetemel"],
                "instructions": ["Lag sausen.", "Varm fiskebollene i sausen."],
            }
        )
        self.stop_reason = "end_turn"
        self.error: Exception | None = None
        self.options: dict[str, Any] = {}
        self.sent: dict[str, Any] = {}
        self.messages = self  # so that client.messages.create is self.create
        monkeypatch.setattr("food.reader.anthropic.Anthropic", self.client)

    def client(self, **options: object) -> "FakeAnthropic":
        self.options = options
        return self

    def create(self, **request: object) -> anthropic.types.Message:
        self.sent = request
        if self.error is not None:
            raise self.error
        return anthropic.types.Message.model_validate(
            {
                "id": "msg_test",
                "type": "message",
                "role": "assistant",
                "model": request["model"],
                "content": [{"type": "text", "text": self.text}],
                "stop_reason": self.stop_reason,
                "stop_sequence": None,
                "usage": {"input_tokens": 1700, "output_tokens": 120},
            }
        )


@pytest.fixture
def claude(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> FakeAnthropic:
    settings.FOOD_AI_PROVIDER = "anthropic"
    settings.FOOD_AI_API_KEY = "sk-ant-test"
    return FakeAnthropic(monkeypatch)


def test_anthropic_sends_the_photo_as_an_image_block_and_returns_the_draft(
    client: Client, editor: User, claude: FakeAnthropic
) -> None:
    assert available(client) is True

    response = read(client, recipe_photo("WEBP"), name="side.webp")

    assert response.status_code == 200
    assert response.json() == {
        "readable": True,
        "title": "Fiskeboller i hvit saus",
        "ingredients": "1 boks fiskeboller\n2 ss smør\n2 ss hvetemel",
        "instructions": "Lag sausen.\nVarm fiskebollene i sausen.",
    }
    # One try within the timeout: the SDK's own retries would take the editor past 30 s.
    assert claude.options == {"api_key": "sk-ant-test", "timeout": 25.0, "max_retries": 0}
    assert claude.sent["model"] == "claude-haiku-4-5"
    assert claude.sent["system"] == reader.PROMPT
    image, text = claude.sent["messages"][0]["content"]
    assert text["type"] == "text"
    assert image["type"] == "image"
    assert image["source"]["type"] == "base64"
    assert image["source"]["media_type"] == "image/jpeg"
    with Image.open(BytesIO(base64.b64decode(image["source"]["data"]))) as sent:
        assert (sent.format, sent.size) == ("JPEG", (600, 800))
    read_row = PhotoRead.objects.get()
    assert (read_row.provider, read_row.model, read_row.outcome) == (
        "anthropic",
        "claude-haiku-4-5",
        PhotoRead.Outcome.READ,
    )


def test_anthropic_model_is_a_setting(
    client: Client, editor: User, claude: FakeAnthropic, settings: Settings
) -> None:
    settings.FOOD_AI_MODEL = " claude-sonnet-5 "

    assert read(client, recipe_photo()).status_code == 200
    assert claude.sent["model"] == "claude-sonnet-5"
    assert PhotoRead.objects.get().model == "claude-sonnet-5"


def test_anthropic_without_a_key_is_off(
    client: Client, editor: User, claude: FakeAnthropic, settings: Settings
) -> None:
    settings.FOOD_AI_API_KEY = " "

    assert available(client) is False
    assert read(client, recipe_photo()).status_code == 503
    assert claude.sent == {}


def test_anthropic_finding_no_recipe_could_not_be_read(
    client: Client, editor: User, claude: FakeAnthropic
) -> None:
    claude.text = '```json\n{"readable": false}\n```'

    response = read(client, recipe_photo())

    assert response.status_code == 200
    assert response.json()["readable"] is False
    assert PhotoRead.objects.get().outcome == PhotoRead.Outcome.UNREADABLE


@pytest.mark.parametrize(
    ("error", "status", "message"),
    [
        (anthropic.APITimeoutError(ANTHROPIC_REQUEST), 504, reader.TIMED_OUT),
        (anthropic.APIConnectionError(request=ANTHROPIC_REQUEST), 502, reader.FAILED),
        (anthropic_status(anthropic.AuthenticationError, 401), 502, reader.FAILED),
        (anthropic_status(anthropic.RateLimitError, 429), 502, reader.FAILED),
        (anthropic_status(anthropic.OverloadedError, 529), 502, reader.FAILED),
    ],
)
def test_an_anthropic_error_or_timeout_is_a_clear_answer(
    client: Client,
    editor: User,
    claude: FakeAnthropic,
    error: Exception,
    status: int,
    message: str,
) -> None:
    claude.error = error

    response = read(client, recipe_photo())

    assert response.status_code == status
    assert response.json() == {"detail": message}
    assert PhotoRead.objects.get().outcome == PhotoRead.Outcome.FAILED


@pytest.mark.parametrize("stop_reason", ["max_tokens", "refusal"])
def test_an_anthropic_answer_cut_short_is_a_provider_error(
    client: Client, editor: User, claude: FakeAnthropic, stop_reason: str
) -> None:
    claude.stop_reason = stop_reason

    assert read(client, recipe_photo()).status_code == 502
    assert PhotoRead.objects.get().outcome == PhotoRead.Outcome.FAILED


# --- switching provider is a setting, not code ---


def test_switching_provider_by_settings_only(
    client: Client,
    editor: User,
    provider: FakeProvider,
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    FakeAnthropic(monkeypatch)

    def title() -> object:
        response = read(client, recipe_photo())
        return response.json().get("title", response.status_code)

    assert title() == "Mormors kjøttkaker"
    settings.FOOD_AI_PROVIDER = "fake"
    assert title() == "Sveler"
    settings.FOOD_AI_PROVIDER = "off"
    assert title() == 503
    settings.FOOD_AI_PROVIDER = "something-else"
    assert title() == 503
    settings.FOOD_AI_PROVIDER = " OpenAI_Compatible "
    assert title() == "Mormors kjøttkaker"
    settings.FOOD_AI_PROVIDER = "anthropic"  # the same FOOD_AI_API_KEY and FOOD_AI_MODEL
    assert title() == "Fiskeboller i hvit saus"
    assert list(PhotoRead.objects.values_list("provider", flat=True).order_by("id")) == [
        "openai_compatible",
        "fake",
        "openai_compatible",
        "anthropic",
    ]


# --- the admin: cost per photo and the count ---


def test_the_admin_shows_the_cost_per_photo_and_the_count(
    client: Client, settings: Settings
) -> None:
    settings.FOOD_AI_PROVIDER = "fake"
    settings.FOOD_AI_COST_PER_PHOTO = "ca. 0,02 kr"
    for _ in range(3):
        PhotoRead.objects.create(provider="fake", outcome=PhotoRead.Outcome.READ)
    user = sign_in_as(client, "stig@example.com", editor=False)
    user.is_staff = user.is_superuser = True
    user.save()

    response = client.get("/api/admin/food/photoread/")

    assert response.status_code == 200
    page = response.content.decode()
    assert "Kostnad per bilde: <strong>ca. 0,02 kr</strong>" in page
    assert "Lesinger i alt: <strong>3</strong>" in page
    assert "Leverandør: <strong>fake</strong>" in page
    # Read-only: nothing to add, and a read cannot be changed or deleted.
    assert client.get("/api/admin/food/photoread/add/").status_code == 403
    read_row = PhotoRead.objects.first()
    assert read_row is not None
    response = client.post(f"/api/admin/food/photoread/{read_row.pk}/delete/", {"post": "yes"})
    assert response.status_code == 403
    assert PhotoRead.objects.count() == 3


def test_the_admin_says_when_reading_is_off_and_no_cost_is_set(client: Client) -> None:
    user = sign_in_as(client, "stig@example.com", editor=False)
    user.is_staff = user.is_superuser = True
    user.save()

    page = client.get("/api/admin/food/photoread/").content.decode()

    assert "Leverandør: <strong>av (off)</strong>" in page
    assert "Kostnad per bilde: <strong>ikke oppgitt</strong>" in page


def test_the_admin_shows_claudes_cost_unless_the_setting_says_otherwise(
    client: Client, settings: Settings
) -> None:
    settings.FOOD_AI_PROVIDER = "anthropic"
    settings.FOOD_AI_API_KEY = "sk-ant-test"
    user = sign_in_as(client, "stig@example.com", editor=False)
    user.is_staff = user.is_superuser = True
    user.save()

    def cost() -> str:
        page = client.get("/api/admin/food/photoread/").content.decode()
        assert "Leverandør: <strong>anthropic</strong>" in page
        return page.split("Kostnad per bilde: <strong>")[1].split("</strong>")[0]

    assert cost() == "ca. $0.007 per bilde (Claude Haiku 4.5)"
    settings.FOOD_AI_MODEL = "claude-sonnet-5"  # another price: only the setting can say it
    assert cost() == "ikke oppgitt"
    settings.FOOD_AI_COST_PER_PHOTO = "ca. 0,25 kr"
    assert cost() == "ca. 0,25 kr"


# --- over a real socket: a local stand-in server, slow or not ---


class StandIn(BaseHTTPRequestHandler):
    delay = 0.0

    def do_POST(self) -> None:
        self.rfile.read(int(self.headers["Content-Length"]))
        time.sleep(self.delay)
        content = json.dumps({"title": "Lefser", "ingredients": ["1 kg poteter"]})
        body = json.dumps({"choices": [{"message": {"content": content}}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        pass


@pytest.fixture
def stand_in(settings: Settings) -> Iterator[type[StandIn]]:
    handler = type("Handler", (StandIn,), {})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    settings.FOOD_AI_PROVIDER = "openai_compatible"
    settings.FOOD_AI_BASE_URL = f"http://127.0.0.1:{server.server_port}/v1"
    settings.FOOD_AI_MODEL = "local"
    settings.FOOD_AI_TIMEOUT = 0.5
    yield handler
    server.shutdown()
    server.server_close()


def test_a_real_round_trip(client: Client, editor: User, stand_in: type[StandIn]) -> None:
    response = read(client, recipe_photo())

    assert response.status_code == 200
    assert response.json()["title"] == "Lefser"


def test_a_slow_provider_times_out_at_the_setting(
    client: Client, editor: User, stand_in: type[StandIn]
) -> None:
    stand_in.delay = 1.5
    started = time.monotonic()

    response = read(client, recipe_photo())

    assert response.status_code == 504
    assert response.json() == {"detail": reader.TIMED_OUT}
    assert time.monotonic() - started < 1.4
