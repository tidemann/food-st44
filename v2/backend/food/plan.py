"""The household's week plan (ST-1231): one dinner a day, a recipe or a short text.

The plan is private on an open site: every endpoint here, reads included, needs an editor
(`editor_auth`, 403 for anyone else), and so do the MCP plan tools (food.mcp). The rules live
here once, for the site's API and for MCP alike.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from django.contrib.auth.models import User
from django.db import transaction
from django.http import HttpRequest
from django.utils import timezone
from ninja import Router, Status
from ninja.errors import HttpError

from food.auth import editor_auth
from food.models import PlannedDinner, Recipe
from food.schemas import (
    MAX_PORTIONS,
    PORTIONS_RANGE,
    DinnerIn,
    ErrorOut,
    MoveIn,
    MoveOut,
    PlanDayOut,
    PlanWeekOut,
    ValidationErrors,
)

router = Router(tags=["plan"], auth=editor_auth)

WEEKDAYS = ("mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag")
TEXT_MAX_CHARS = 80

BAD_WEEK = "Uken må se ut som 2026-W43 (eller en dato som 2026-10-22)."
RECIPE_OR_TEXT = "Velg en oppskrift eller skriv en kort tekst, ikke begge."
NO_TEXT = "Skriv en kort tekst."
TEXT_TOO_LONG = "Teksten kan være høyst 80 tegn."
NO_RECIPE = "Fant ingen oppskrift med id {id}."
NOTHING_TO_MOVE = "Det er ingen middag å flytte den dagen."


class PlanError(Exception):
    """A change the rules refuse, with the field it is about and a message to show."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field
        self.message = message


def today() -> date:
    """The date in Norway (TIME_ZONE): "I dag" and "this week" follow the household's clock."""
    return timezone.localdate()


def monday_of(day: date) -> date:
    return day - timedelta(days=day.weekday())


def week_name(monday: date) -> str:
    year, number, _ = monday.isocalendar()
    return f"{year}-W{number:02d}"


def parse_week(value: str) -> date:
    """The Monday of `value`: an ISO week ("2026-W43") or any date in it ("2026-10-22"). Blank
    is this week. Raises PlanError for anything else, including a week 53 a year lacks."""
    value = value.strip()
    if not value:
        return monday_of(today())
    try:
        if "W" in value.upper():
            year, _, number = value.upper().partition("-W")
            return date.fromisocalendar(int(year), int(number), 1)
        return monday_of(date.fromisoformat(value))
    except ValueError as exc:
        raise PlanError("week", BAD_WEEK) from exc


def display_name(user: User | None) -> str:
    if user is None:
        return ""
    return user.first_name or user.email


def day_out(day: date, dinner: PlannedDinner | None) -> dict[str, Any]:
    """A day as the API and MCP send it (food.schemas.PlanDayOut)."""
    recipe = dinner.recipe if dinner else None
    return {
        "date": day,
        "weekday": WEEKDAYS[day.weekday()],
        "recipe_id": recipe.id if recipe else None,
        "title": (recipe.title if recipe else dinner.recipe_title) if dinner else "",
        "text": dinner.text if dinner else "",
        "portions": dinner.portions if dinner else None,
        "servings": recipe.servings if recipe else None,
        "recipe_deleted": bool(dinner and dinner.recipe_title and recipe is None),
        "set_by": display_name(dinner.set_by) if dinner else "",
        "set_at": dinner.set_at if dinner else None,
    }


def read_days(start: date, count: int) -> list[dict[str, Any]]:
    """`count` days from `start`, every one of them, empty or not."""
    end = start + timedelta(days=count - 1)
    dinners = {
        dinner.date: dinner
        for dinner in PlannedDinner.objects.filter(date__range=(start, end)).select_related(
            "recipe", "set_by"
        )
    }
    return [day_out(day, dinners.get(day)) for day in _dates(start, count)]


def _dates(start: date, count: int) -> list[date]:
    return [start + timedelta(days=offset) for offset in range(count)]


def read_week(monday: date) -> dict[str, Any]:
    days = read_days(monday, 7)
    _, number, _ = monday.isocalendar()
    latest = max((day for day in days if day["set_at"]), key=lambda d: d["set_at"], default=None)
    return {
        "week": week_name(monday),
        "number": number,
        "start": monday,
        "end": monday + timedelta(days=6),
        "previous": week_name(monday - timedelta(days=7)),
        "next": week_name(monday + timedelta(days=7)),
        "today": today(),
        "days": days,
        "last_change_by": latest["set_by"] if latest else "",
        "last_change_at": latest["set_at"] if latest else None,
    }


def get_day(day: date) -> dict[str, Any]:
    dinner = PlannedDinner.objects.select_related("recipe", "set_by").filter(date=day).first()
    return day_out(day, dinner)


@dataclass(frozen=True)
class Dinner:
    """What a day is set to, checked: a recipe, or a text."""

    recipe: Recipe | None
    text: str
    portions: int | None


def check(*, recipe_id: int | None, text: str | None, portions: int | None) -> Dinner:
    """The rules for one day's dinner. A recipe without portions gets the recipe's porsjoner; a
    text day has no portions."""
    if recipe_id is not None and text is not None and text.strip():
        raise PlanError("text", RECIPE_OR_TEXT)
    if portions is not None and not 1 <= portions <= MAX_PORTIONS:
        raise PlanError("portions", PORTIONS_RANGE)
    if recipe_id is not None:
        recipe = Recipe.objects.filter(pk=recipe_id).first()
        if recipe is None:
            raise PlanError("recipe_id", NO_RECIPE.format(id=recipe_id))
        return Dinner(recipe, "", portions if portions is not None else recipe.servings)
    if text is None:
        raise PlanError("text", RECIPE_OR_TEXT)
    text = text.strip()
    if not text:
        raise PlanError("text", NO_TEXT)
    if len(text) > TEXT_MAX_CHARS:
        raise PlanError("text", TEXT_TOO_LONG)
    return Dinner(None, text, None)


def set_dinner(day: date, dinner: Dinner, user: User) -> dict[str, Any]:
    """Puts `dinner` on `day`, replacing what was there."""
    PlannedDinner.objects.update_or_create(
        date=day,
        defaults={
            "recipe": dinner.recipe,
            "recipe_title": dinner.recipe.title if dinner.recipe else "",
            "text": dinner.text,
            "portions": dinner.portions,
            "set_by": user,
            "set_at": timezone.now(),
        },
    )
    return get_day(day)


def clear_dinner(day: date) -> bool:
    """Empties `day`. False when it was empty already."""
    deleted, _ = PlannedDinner.objects.filter(date=day).delete()
    return deleted > 0


_CONTENT = ("recipe", "recipe_title", "text", "portions", "set_by", "set_at")


@transaction.atomic
def move_dinner(source: date, target: date, user: User) -> list[dict[str, Any]]:
    """Moves the dinner on `source` to `target`. If `target` has one, the two swap places:
    the rows keep their dates and trade what is on them, so the unique date is never broken."""
    moving = PlannedDinner.objects.select_for_update().filter(date=source).first()
    if moving is None:
        raise PlanError("from", NOTHING_TO_MOVE)
    if source != target:
        other = PlannedDinner.objects.select_for_update().filter(date=target).first()
        now = timezone.now()
        if other is None:
            moving.date, moving.set_by, moving.set_at = target, user, now
            moving.save()
        else:
            for name in _CONTENT:
                mine, theirs = getattr(moving, name), getattr(other, name)
                setattr(moving, name, theirs)
                setattr(other, name, mine)
            for row in (moving, other):
                row.set_by, row.set_at = user, now
                row.save()
    return [get_day(source), get_day(target)]


# --- /api/plan


def _invalid(error: PlanError) -> Status[dict[str, dict[str, str]]]:
    return Status(422, {"errors": {error.field: error.message}})


@router.get(
    "",
    response={200: PlanWeekOut, 403: ErrorOut, 422: ValidationErrors},
    operation_id="get_plan_week",
    summary="One week of the plan, Monday to Sunday; `week` is 2026-W43 or a date in it",
)
def get_week(
    request: HttpRequest, week: str = ""
) -> dict[str, Any] | Status[dict[str, dict[str, str]]]:
    try:
        return read_week(parse_week(week))
    except PlanError as error:
        return _invalid(error)


@router.put(
    "/{day}",
    response={200: PlanDayOut, 403: ErrorOut, 422: ValidationErrors},
    operation_id="set_plan_day",
    summary="Set a day's dinner: a recipe (`recipe_id`, `portions`) or a short `text`",
)
def put_day(
    request: HttpRequest, day: date, payload: DinnerIn
) -> dict[str, Any] | Status[dict[str, dict[str, str]]]:
    try:
        dinner = check(**payload.model_dump())
    except PlanError as error:
        return _invalid(error)
    return set_dinner(day, dinner, _user(request))


@router.delete(
    "/{day}",
    response={204: None, 403: ErrorOut},
    operation_id="clear_plan_day",
    summary="Clear a day (no error if it is empty)",
)
def delete_day(request: HttpRequest, day: date) -> Status[None]:
    clear_dinner(day)
    return Status(204, None)


@router.post(
    "/{day}/move",
    response={200: MoveOut, 403: ErrorOut, 422: ValidationErrors},
    operation_id="move_plan_day",
    summary="Move a day's dinner to another day; if that day has one, the two swap",
)
def move_day(
    request: HttpRequest, day: date, payload: MoveIn
) -> dict[str, Any] | Status[dict[str, dict[str, str]]]:
    try:
        return {"days": move_dinner(day, payload.to, _user(request))}
    except PlanError as error:
        return _invalid(error)


def _user(request: HttpRequest) -> User:
    user = request.user
    if not isinstance(user, User):  # editor_auth lets only a User through; this is for mypy
        raise HttpError(403, "Bare husstandens redaktører kan endre ukeplanen.")
    return user
