from dataclasses import asdict

from django.conf import settings
from django.contrib.auth.models import User
from django.http import HttpRequest
from django.shortcuts import get_object_or_404
from ninja import File, Router, Status, UploadedFile

from food import importer, photos, reader, services
from food.auth import editor_auth, is_editor
from food.models import Recipe
from food.schemas import (
    ErrorOut,
    LinkImportIn,
    PhotoReadingOut,
    RecipeDraftOut,
    RecipeIn,
    RecipeOut,
    TagOut,
    TextDraftOut,
    TextImportIn,
    ValidationErrors,
)

# Reads are public. Writes need a signed-in editor (food.auth); anyone else gets 403.
router = Router(tags=["recipes"])
# /api/tags: the emneord in use (ST-784). Read-only; tags change with the recipes that carry them.
tags_router = Router(tags=["tags"])


@router.get(
    "",
    response=list[RecipeOut],
    operation_id="list_recipes",
    summary="The collection, newest first; `q` searches the titles, `tag` keeps one emneord",
)
def list_recipes(request: HttpRequest, q: str = "", tag: str = "") -> list[Recipe]:
    return services.search_recipes(q, tag)


@tags_router.get(
    "",
    response=list[TagOut],
    operation_id="list_tags",
    summary="Every emneord at least one recipe carries, with its count, in Norwegian order",
)
def list_tags(request: HttpRequest) -> list[dict[str, object]]:
    return services.tags_in_use()


@router.post(
    "",
    response={201: RecipeOut, 403: ErrorOut, 422: ValidationErrors},
    auth=editor_auth,
    operation_id="create_recipe",
)
def create_recipe(request: HttpRequest, payload: RecipeIn) -> Status[Recipe]:
    return Status(201, services.create_recipe(**payload.model_dump()))


# --- reading a recipe from a photo (food.reader) ---


@router.get(
    "/read-photo",
    response=PhotoReadingOut,
    operation_id="get_photo_reading",
    summary="Whether this visitor can read a recipe from a photo (the button shows only then)",
)
def get_photo_reading(request: HttpRequest) -> dict[str, bool]:
    return {"available": reader.available() and is_editor(request.user)}


@router.post(
    "/read-photo",
    response={
        200: RecipeDraftOut,
        403: ErrorOut,
        413: ValidationErrors,
        422: ValidationErrors,
        502: ErrorOut,
        503: ErrorOut,
        504: ErrorOut,
    },
    auth=editor_auth,
    operation_id="read_recipe_photo",
    summary="Read a recipe from a photo into a draft; saves nothing, not even the photo",
    description=(
        "multipart/form-data, the file in `photo`. 200 with `readable: false` when no recipe "
        "could be read. 503 when reading is off; 502 or 504 when the provider failed or was "
        "too slow."
    ),
)
def read_recipe_photo(
    request: HttpRequest, photo: File[UploadedFile]
) -> dict[str, object] | Status[dict[str, object]]:
    if photo.size is None or photo.size > settings.PHOTO_MAX_UPLOAD_BYTES:
        return Status(413, {"errors": {"photo": photos.TOO_LARGE}})
    user = request.user
    try:
        draft = reader.read_photo(photo, editor=user.email if isinstance(user, User) else "")
    except reader.ReaderOff as exc:
        return Status(503, {"detail": str(exc)})
    except photos.PhotoError as exc:
        return Status(422, {"errors": {"photo": str(exc)}})
    except reader.ProviderError as exc:
        if exc.timed_out:
            return Status(504, {"detail": reader.TIMED_OUT})
        return Status(502, {"detail": reader.FAILED})
    return {"readable": draft.readable, **asdict(draft)}


# --- importing a recipe from a link (no AI) or from text (AI, rules as fallback) ---


@router.post(
    "/import-link",
    response={
        200: RecipeDraftOut,
        403: ErrorOut,
        422: ValidationErrors,
        502: ErrorOut,
        504: ErrorOut,
    },
    auth=editor_auth,
    operation_id="import_recipe_link",
    summary="Read the schema.org recipe on a web page into a draft; saves nothing",
    description=(
        "200 with `readable: false` when the page has no recipe data. 422 for a link we do not "
        "fetch (not http/https, another port, a private address). 502 when the site could not "
        "be fetched or refused; 504 when it was too slow."
    ),
)
def import_recipe_link(
    request: HttpRequest, payload: LinkImportIn
) -> dict[str, object] | Status[dict[str, object]]:
    try:
        draft = importer.import_link(payload.url)
    except importer.NotAllowed as exc:
        return Status(422, {"errors": {"url": str(exc)}})
    except importer.FetchError as exc:
        return Status(504 if exc.timed_out else 502, {"detail": str(exc)})
    return {"readable": draft.readable, **asdict(draft)}


@router.post(
    "/import-text",
    response={200: TextDraftOut, 403: ErrorOut, 422: ValidationErrors},
    auth=editor_auth,
    operation_id="import_recipe_text",
    summary="Read a recipe pasted as plain text into a draft; saves nothing",
    description=(
        "Read by the same provider as photos when reading is on (`read_by: ai`, counted like a "
        "photo read). When reading is off or the provider fails, the text is split by simple "
        "rules instead (`read_by: rules`) and `notice` says why. 200 with `readable: false` "
        "when no recipe was found."
    ),
)
def import_recipe_text(request: HttpRequest, payload: TextImportIn) -> dict[str, object]:
    user = request.user
    try:
        draft = reader.read_text(payload.text, editor=user.email if isinstance(user, User) else "")
    except reader.ReaderOff:
        notice = importer.RULES_READER_OFF
    except reader.ProviderError as exc:
        notice = importer.RULES_TIMED_OUT if exc.timed_out else importer.RULES_FAILED
    else:
        return {"readable": draft.readable, **asdict(draft), "read_by": "ai", "notice": ""}
    draft = importer.split_text(payload.text)
    return {"readable": draft.readable, **asdict(draft), "read_by": "rules", "notice": notice}


@router.get(
    "/{recipe_id}",
    response={200: RecipeOut, 404: ErrorOut},
    operation_id="get_recipe",
)
def get_recipe(request: HttpRequest, recipe_id: int) -> Recipe:
    return get_object_or_404(Recipe, pk=recipe_id)


@router.put(
    "/{recipe_id}",
    response={200: RecipeOut, 403: ErrorOut, 404: ErrorOut, 422: ValidationErrors},
    auth=editor_auth,
    operation_id="update_recipe",
)
def update_recipe(request: HttpRequest, recipe_id: int, payload: RecipeIn) -> Recipe:
    recipe = get_object_or_404(Recipe, pk=recipe_id)
    return services.update_recipe(recipe, **payload.model_dump())


@router.delete(
    "/{recipe_id}",
    response={204: None, 403: ErrorOut, 404: ErrorOut},
    auth=editor_auth,
    operation_id="delete_recipe",
)
def delete_recipe(request: HttpRequest, recipe_id: int) -> Status[None]:
    services.delete_recipe(get_object_or_404(Recipe, pk=recipe_id))
    return Status(204, None)


# --- the recipe's photo (food.photos) ---


@router.post(
    "/{recipe_id}/photo",
    response={
        200: RecipeOut,
        403: ErrorOut,
        404: ErrorOut,
        413: ValidationErrors,
        422: ValidationErrors,
    },
    auth=editor_auth,
    operation_id="set_recipe_photo",
    summary="Add or replace the recipe's photo: multipart/form-data, the file in `photo`",
)
def set_recipe_photo(
    request: HttpRequest, recipe_id: int, photo: File[UploadedFile]
) -> Recipe | Status[dict[str, dict[str, str]]]:
    recipe = get_object_or_404(Recipe, pk=recipe_id)
    if photo.size is None or photo.size > settings.PHOTO_MAX_UPLOAD_BYTES:
        return Status(413, {"errors": {"photo": photos.TOO_LARGE}})
    try:
        return photos.save(recipe, photo)
    except photos.PhotoError as exc:
        return Status(422, {"errors": {"photo": str(exc)}})


@router.delete(
    "/{recipe_id}/photo",
    response={200: RecipeOut, 403: ErrorOut, 404: ErrorOut},
    auth=editor_auth,
    operation_id="delete_recipe_photo",
    summary="Remove the recipe's photo (no error if it has none)",
)
def delete_recipe_photo(request: HttpRequest, recipe_id: int) -> Recipe:
    return photos.remove(get_object_or_404(Recipe, pk=recipe_id))
