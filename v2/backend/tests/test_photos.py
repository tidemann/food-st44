import os
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager
from io import BytesIO, StringIO
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest
from django.conf import settings as django_settings
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import Client
from django.test.utils import override_settings
from PIL import Image

from food import photos
from food.management.commands.import_v1_photos import slugify
from food.models import Editor, Recipe

if TYPE_CHECKING:
    from django.test.client import _MonkeyPatchedWSGIResponse as Response

pytestmark = pytest.mark.django_db

V1_PHOTOS = Path(django_settings.BASE_DIR).parent.parent / "public/img/recipes"

OnCommit = Callable[..., AbstractContextManager[list[Callable[[], Any]]]]


@pytest.fixture(autouse=True)
def photos_dir(tmp_path: Path) -> Iterator[Path]:
    with override_settings(PHOTOS_DIR=tmp_path / "photos"):
        yield tmp_path / "photos"


@pytest.fixture
def editor(client: Client) -> User:
    user = User.objects.create(username="google:editor", email="editor@example.com")
    Editor.objects.create(email=user.email)
    client.force_login(user)
    return user


def image(fmt: str = "JPEG") -> bytes:
    mode = "RGBA" if fmt in {"PNG", "WEBP"} else "RGB"
    out = BytesIO()
    Image.new(mode, (800, 600), (164, 20, 46, 128)[: len(mode)]).save(out, fmt)
    return out.getvalue()


def upload(client: Client, recipe: Recipe, data: bytes, name: str = "IMG_0001.jpg") -> "Response":
    return client.post(f"/api/recipes/{recipe.pk}/photo", {"photo": SimpleUploadedFile(name, data)})


def stored(photos_dir: Path, recipe: Recipe) -> Image.Image:
    recipe.refresh_from_db()
    return Image.open(photos_dir / recipe.photo)


def make(title: str = "Lapskaus") -> Recipe:
    return Recipe.objects.create(title=title, ingredients="x")


# --- upload, replace, delete ---


def test_an_editor_uploads_a_photo_and_the_recipe_shows_it(
    client: Client, editor: User, photos_dir: Path
) -> None:
    recipe = make()

    response = upload(client, recipe, image("JPEG"))

    assert response.status_code == 200
    photo_url = response.json()["photo_url"]
    assert photo_url.startswith(f"/photos/{recipe.pk}-")
    assert photo_url.endswith(".webp")
    assert client.get(f"/api/recipes/{recipe.pk}").json()["photo_url"] == photo_url
    assert client.get("/api/recipes").json()[0]["photo_url"] == photo_url

    served = client.get(photo_url)
    assert served.status_code == 200
    assert served["Content-Type"] == "image/webp"
    assert "immutable" in served["Cache-Control"]
    assert Image.open(BytesIO(served.getvalue())).format == "WEBP"


def test_a_recipe_without_a_photo_has_a_null_photo_url(client: Client) -> None:
    recipe = make()
    assert client.get(f"/api/recipes/{recipe.pk}").json()["photo_url"] is None


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP"])
def test_jpeg_png_and_webp_are_accepted_whatever_the_file_is_called(
    client: Client, editor: User, fmt: str
) -> None:
    # The content decides, not the name: a PNG called .jpg is fine.
    assert upload(client, make(), image(fmt), name="photo.jpg").status_code == 200


def test_a_large_phone_photo_is_resized_turned_upright_and_stripped(
    client: Client, editor: User, photos_dir: Path
) -> None:
    # A sideways phone photo, over 10 MB: EXIF says "rotate 90° clockwise to view", plus the
    # kind of metadata we must not publish.
    exif = Image.Exif()
    exif[0x0112] = 6  # Orientation
    exif[0x010F] = "PhoneMaker"  # Make
    exif[0x0132] = "2026:10:05 08:00:00"  # DateTime
    noise = Image.frombytes("RGB", (4000, 3000), os.urandom(4000 * 3000 * 3))
    out = BytesIO()
    noise.save(out, "JPEG", quality=95, exif=exif)
    data = out.getvalue()
    assert len(data) > 10 * 2**20

    response = upload(client, make(), data)

    assert response.status_code == 200
    recipe = Recipe.objects.get()
    with stored(photos_dir, recipe) as photo:
        assert photo.size == (1200, 1600)  # upright (portrait), long edge 1600
        assert not photo.getexif()
        assert "xmp" not in photo.info
    assert (photos_dir / recipe.photo).stat().st_size < 2 * 2**20


def test_transparency_survives(client: Client, editor: User, photos_dir: Path) -> None:
    upload(client, make(), image("PNG"))
    with stored(photos_dir, Recipe.objects.get()) as photo:
        assert photo.mode == "RGBA"


def test_replacing_a_photo_removes_the_old_file(
    client: Client,
    editor: User,
    photos_dir: Path,
    django_capture_on_commit_callbacks: OnCommit,
) -> None:
    recipe = make()
    first = upload(client, recipe, image()).json()["photo_url"]
    with django_capture_on_commit_callbacks(execute=True):
        second = upload(client, recipe, image("PNG")).json()["photo_url"]

    assert second != first
    assert sorted(path.name for path in photos_dir.iterdir()) == [second.removeprefix("/photos/")]
    assert client.get(first).status_code == 404
    assert client.get(second).status_code == 200


def test_removing_a_photo(
    client: Client,
    editor: User,
    photos_dir: Path,
    django_capture_on_commit_callbacks: OnCommit,
) -> None:
    recipe = make()
    photo_url = upload(client, recipe, image()).json()["photo_url"]

    with django_capture_on_commit_callbacks(execute=True):
        response = client.delete(f"/api/recipes/{recipe.pk}/photo")

    assert response.status_code == 200
    assert response.json()["photo_url"] is None
    assert list(photos_dir.iterdir()) == []
    assert client.get(photo_url).status_code == 404
    # Removing it again is not an error.
    assert client.delete(f"/api/recipes/{recipe.pk}/photo").status_code == 200


def test_deleting_the_recipe_deletes_its_photo(
    client: Client,
    editor: User,
    photos_dir: Path,
    django_capture_on_commit_callbacks: OnCommit,
) -> None:
    recipe = make()
    upload(client, recipe, image())

    with django_capture_on_commit_callbacks(execute=True):
        assert client.delete(f"/api/recipes/{recipe.pk}").status_code == 204

    assert list(photos_dir.iterdir()) == []


def test_no_such_recipe(client: Client, editor: User) -> None:
    assert upload(client, Recipe(pk=999), image()).status_code == 404
    assert client.delete("/api/recipes/999/photo").status_code == 404


# --- who may ---


def test_anonymous_and_non_editors_get_403(client: Client, photos_dir: Path) -> None:
    recipe = make()
    guest = User.objects.create(username="google:guest", email="guest@example.com")
    for user in (None, guest):  # anonymous, then signed in but not on the editor list
        if user is not None:
            client.force_login(user)
        assert upload(client, recipe, image()).status_code == 403
        assert client.delete(f"/api/recipes/{recipe.pk}/photo").status_code == 403

    assert not photos_dir.exists()
    recipe.refresh_from_db()
    assert recipe.photo == ""


# --- refused uploads: a message for under the field ---


def test_too_large_is_413_with_a_message(client: Client, editor: User) -> None:
    with override_settings(PHOTO_MAX_UPLOAD_BYTES=1000):
        response = upload(client, make(), image())

    assert response.status_code == 413
    assert response.json() == {"errors": {"photo": photos.TOO_LARGE}}
    assert "25 MB" in photos.TOO_LARGE


@pytest.mark.parametrize(
    "data",
    [
        b"not a photo at all",
        b"%PDF-1.7\n",
        image("GIF"),  # an image, but not one we take
        image("JPEG")[:200],  # cut off
    ],
    ids=["text", "pdf", "gif", "truncated"],
)
def test_not_an_image_is_422_with_a_message(
    client: Client, editor: User, photos_dir: Path, data: bytes
) -> None:
    recipe = make()

    response = upload(client, recipe, data, name="photo.jpg")

    assert response.status_code == 422
    assert response.json() == {"errors": {"photo": photos.NOT_AN_IMAGE}}
    recipe.refresh_from_db()
    assert recipe.photo == ""
    assert not photos_dir.exists()


def test_no_file_is_422(client: Client, editor: User) -> None:
    response = client.post(f"/api/recipes/{make().pk}/photo", {})
    assert response.status_code == 422
    assert "photo" in response.json()["errors"]


# --- serving ---


@pytest.mark.parametrize("name", ["1-0123456789abcdef.webp", "..%2Fdb.sqlite3", "x.webp"])
def test_unknown_or_odd_photo_names_are_404(client: Client, name: str) -> None:
    assert client.get(f"/photos/{name}").status_code == 404


# --- moving v1's photos ---


@pytest.mark.parametrize(
    ("title", "slug"),
    [
        ("Fårikål", "farikal"),
        ("Kjøttkaker i brun saus", "kjottkaker-i-brun-saus"),
        ("Rømmegrøt", "rommegrot"),
        ("Smørbrød med reker!", "smorbrod-med-reker"),
        ("  Crème brûlée  ", "creme-brulee"),
        ("Ærlig talt", "aerlig-talt"),
    ],
)
def test_slugify_matches_v1(title: str, slug: str) -> None:
    assert slugify(title) == slug


def import_v1(path: Path) -> tuple[str, str]:
    out, err = StringIO(), StringIO()
    call_command("import_v1_photos", str(path), stdout=out, stderr=err)
    return out.getvalue(), err.getvalue()


def test_every_v1_photo_lands_on_its_recipe(photos_dir: Path) -> None:
    titles = {
        "Fårikål": "farikal",
        "Fiskegrateng": "fiskegrateng",
        "Kjøttkaker i brun saus": "kjottkaker-i-brun-saus",
        "Lapskaus": "lapskaus",
        "Pinnekjøtt": "pinnekjott",
        "Raspeballer": "raspeballer",
        "Rømmegrøt": "rommegrot",
        "Sveler": "sveler",
    }
    assert sorted(path.stem for path in V1_PHOTOS.glob("*.jpg")) == sorted(titles.values())
    for title in titles:
        make(title)
    without = make("Taco")

    out, err = import_v1(V1_PHOTOS)

    assert err == ""
    assert "Added a photo to 8 recipe(s)." in out
    for recipe in Recipe.objects.exclude(pk=without.pk):
        assert recipe.photo, recipe.title
        with stored(photos_dir, recipe) as photo:
            assert photo.format == "WEBP"
    without.refresh_from_db()
    assert without.photo == ""


def test_moving_v1_photos_twice_changes_nothing(tmp_path: Path, photos_dir: Path) -> None:
    source = tmp_path / "v1"
    source.mkdir()
    (source / "farikal.jpg").write_bytes(image())
    (source / "lapskaus.png").write_bytes(image("PNG"))
    (source / "README.md").write_text("not a photo")
    farikal, lapskaus = make("Fårikål"), make("Lapskaus")
    lapskaus.photo = "kept-by-an-editor.webp"
    lapskaus.save()

    import_v1(source)
    farikal.refresh_from_db()
    first = farikal.photo
    out, _ = import_v1(source)

    farikal.refresh_from_db()
    lapskaus.refresh_from_db()
    assert farikal.photo == first != ""
    assert lapskaus.photo == "kept-by-an-editor.webp"
    assert "Added a photo to 0 recipe(s)." in out
    assert len(list(photos_dir.iterdir())) == 1


def test_a_broken_v1_file_is_skipped_not_fatal(tmp_path: Path) -> None:
    source = tmp_path / "v1"
    source.mkdir()
    (source / "farikal.jpg").write_bytes(b"broken")
    (source / "sveler.jpg").write_bytes(image())
    make("Fårikål")
    make("Sveler")

    out, err = import_v1(source)

    assert "farikal.jpg" in err
    assert "Added a photo to 1 recipe(s)." in out
