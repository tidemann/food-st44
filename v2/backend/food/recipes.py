from django.conf import settings
from django.http import HttpRequest
from django.shortcuts import get_object_or_404
from ninja import File, Router, Status, UploadedFile

from food import photos, services
from food.auth import editor_auth
from food.models import Recipe
from food.schemas import ErrorOut, RecipeIn, RecipeOut, ValidationErrors

# Reads are public. Writes need a signed-in editor (food.auth); anyone else gets 403.
router = Router(tags=["recipes"])


@router.get("", response=list[RecipeOut], operation_id="list_recipes")
def list_recipes(request: HttpRequest, q: str = "") -> list[Recipe]:
    return services.search_recipes(q)


@router.post(
    "",
    response={201: RecipeOut, 403: ErrorOut, 422: ValidationErrors},
    auth=editor_auth,
    operation_id="create_recipe",
)
def create_recipe(request: HttpRequest, payload: RecipeIn) -> Status[Recipe]:
    return Status(201, services.create_recipe(**payload.model_dump()))


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
