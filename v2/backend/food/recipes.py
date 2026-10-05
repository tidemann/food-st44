from django.http import HttpRequest
from django.shortcuts import get_object_or_404
from ninja import Router, Status

from food import services
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
    get_object_or_404(Recipe, pk=recipe_id).delete()
    return Status(204, None)
