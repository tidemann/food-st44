"""Meals (ST-1968): dinners without a recipe, only a name, what to buy and a short note.

Reads are public, as for recipes; writes need an editor. The days a meal is planned on are part
of the week plan, which is private, so `/api/meals/{id}/days` needs an editor too. The rules
live here once, for the site's API and for MCP (food.mcp) alike.
"""

from datetime import date

from django.db import transaction
from django.http import HttpRequest
from django.shortcuts import get_object_or_404
from ninja import Router, Status

from food import plan
from food.auth import editor_auth
from food.models import Meal, PlannedDinner
from food.schemas import ErrorOut, MealIn, MealOut, ValidationErrors

router = Router(tags=["meals"])


def item_count(meal: Meal) -> int:
    return len(plan.item_lines(meal.items))


def create_meal(*, title: str, items: str, note: str = "") -> Meal:
    return Meal.objects.create(title=title, items=items, note=note)


@transaction.atomic
def update_meal(meal: Meal, *, title: str, items: str, note: str = "") -> Meal:
    """An edit replaces all three; `created_at` stays. The week plan keeps the new title for the
    days that carry the meal."""
    meal.title, meal.items, meal.note = title, items, note
    meal.save(update_fields=["title", "items", "note"])
    PlannedDinner.objects.filter(meal=meal).update(meal_title=title)
    return meal


def delete_meal(meal: Meal) -> None:
    """The days it was planned on keep its title (SET_NULL), as for a deleted recipe."""
    meal.delete()


def planned_days(meal: Meal, since: date) -> list[date]:
    """The days from `since` on that carry the meal, first first."""
    days = PlannedDinner.objects.filter(meal=meal, date__gte=since).values_list("date", flat=True)
    return list(days.order_by("date"))


def meal_out(meal: Meal) -> dict[str, object]:
    return {
        "id": meal.id,
        "title": meal.title,
        "items": meal.items,
        "item_count": item_count(meal),
        "note": meal.note,
        "created_at": meal.created_at,
    }


# --- /api/meals


@router.get(
    "",
    response=list[MealOut],
    operation_id="list_meals",
    summary="Every meal, by title",
)
def list_meals(request: HttpRequest) -> list[dict[str, object]]:
    return [meal_out(meal) for meal in Meal.objects.all()]


@router.post(
    "",
    response={201: MealOut, 403: ErrorOut, 422: ValidationErrors},
    auth=editor_auth,
    operation_id="create_meal",
)
def post_meal(request: HttpRequest, payload: MealIn) -> Status[dict[str, object]]:
    return Status(201, meal_out(create_meal(**payload.model_dump())))


@router.get(
    "/{meal_id}",
    response={200: MealOut, 404: ErrorOut},
    operation_id="get_meal",
)
def get_meal(request: HttpRequest, meal_id: int) -> dict[str, object]:
    return meal_out(get_object_or_404(Meal, pk=meal_id))


@router.put(
    "/{meal_id}",
    response={200: MealOut, 403: ErrorOut, 404: ErrorOut, 422: ValidationErrors},
    auth=editor_auth,
    operation_id="update_meal",
)
def put_meal(request: HttpRequest, meal_id: int, payload: MealIn) -> dict[str, object]:
    meal = get_object_or_404(Meal, pk=meal_id)
    return meal_out(update_meal(meal, **payload.model_dump()))


@router.delete(
    "/{meal_id}",
    response={204: None, 403: ErrorOut, 404: ErrorOut},
    auth=editor_auth,
    operation_id="delete_meal",
)
def remove_meal(request: HttpRequest, meal_id: int) -> Status[None]:
    delete_meal(get_object_or_404(Meal, pk=meal_id))
    return Status(204, None)


@router.get(
    "/{meal_id}/days",
    response={200: list[date], 403: ErrorOut, 404: ErrorOut},
    auth=editor_auth,
    operation_id="get_meal_days",
    summary="The days from today on that the week plan has this meal (for the delete page)",
)
def get_meal_days(request: HttpRequest, meal_id: int) -> list[date]:
    return planned_days(get_object_or_404(Meal, pk=meal_id), plan.today())
