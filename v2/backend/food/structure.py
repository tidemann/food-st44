"""Ingredient groups and method phases (ST-1962).

A recipe's ingredients can be split into titled groups ("Rub", "Glaze") and its method into
phases with a title and an optional time ("Røyk", "3 timer på 110-120 °C"). The flat
`Recipe.ingredients` and `Recipe.instructions` stay the whole text, in order, so search, cook
mode, the backup, the week plan and the Claude app's shopping list read them as before; the two
JSON fields only say how that text is split.

A plain recipe is one untitled group and no phases. Groups or phases that no longer add up to
the flat text (code from before ST-1962 edited the recipe after a rollback) are ignored: the
recipe then reads as a plain one rather than showing stale groups.
"""

from typing import TypedDict

from food.models import Recipe


class Group(TypedDict):
    title: str
    ingredients: str  # one per line


class Phase(TypedDict):
    title: str
    time: str  # optional: "" when not given
    instructions: str  # one paragraph per step


# The form's and the API's messages (ST-1966 §6). The summary names the block; these stand
# under the field.
GROUP_TITLE = "Gruppen må ha en tittel når oppskriften har flere grupper."
GROUP_EMPTY = "Skriv inn minst én ingrediens, eller fjern gruppen."
PHASE_TITLE = "Fasen må ha en tittel."
PHASE_EMPTY = "Skriv inn minst ett steg, eller fjern fasen."
NO_INGREDIENTS = "Skriv inn minst én ingrediens."


def join_ingredients(groups: list[Group]) -> str:
    return "\n".join(group["ingredients"] for group in groups if group["ingredients"])


def join_instructions(phases: list[Phase]) -> str:
    return "\n\n".join(phase["instructions"] for phase in phases if phase["instructions"])


def stored(
    *,
    ingredients: str,
    instructions: str,
    ingredient_groups: list[Group] | None,
    phases: list[Phase] | None,
) -> dict[str, object]:
    """The four fields to save. Without groups (None or []) the flat list is one untitled
    group; with them the flat list is the groups' lines in order. The same for phases and the
    method."""
    groups = ingredient_groups or [Group(title="", ingredients=ingredients)]
    phases = phases or []
    return {
        "ingredients": join_ingredients(groups),
        "ingredient_groups": groups,
        "instructions": join_instructions(phases) if phases else instructions,
        "phases": phases,
    }


def errors(
    *,
    ingredients: str,
    ingredient_groups: list[Group] | None,
    phases: list[Phase] | None,
) -> dict[str, str]:
    """The rules a recipe's structure must meet, one message per field, keyed as the form's
    fields are: "ingredients" for a plain list, "ingredient_groups.1.title" for a group's."""
    found: dict[str, str] = {}
    groups = ingredient_groups or []
    if not groups and not ingredients:
        found["ingredients"] = NO_INGREDIENTS
    for index, group in enumerate(groups):
        if len(groups) > 1 and not group["title"]:
            found[f"ingredient_groups.{index}.title"] = GROUP_TITLE
        if not group["ingredients"]:
            found[f"ingredient_groups.{index}.ingredients"] = GROUP_EMPTY
    for index, phase in enumerate(phases or []):
        if not phase["title"]:
            found[f"phases.{index}.title"] = PHASE_TITLE
        if not phase["instructions"]:
            found[f"phases.{index}.instructions"] = PHASE_EMPTY
    return found


def _texts(value: object, keys: tuple[str, ...]) -> list[dict[str, str]] | None:
    """`value` as a list of objects with these string fields, or None if it is not one."""
    if not isinstance(value, list) or not value:
        return None
    items: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict) or not all(isinstance(item.get(k), str) for k in keys):
            return None
        items.append({key: item[key] for key in keys})
    return items


def groups_of(recipe: Recipe) -> list[Group]:
    """The recipe's ingredient groups: at least one, untitled for a plain list."""
    items = _texts(recipe.ingredient_groups, ("title", "ingredients"))
    if items is not None:
        groups = [Group(title=item["title"], ingredients=item["ingredients"]) for item in items]
        if join_ingredients(groups) == recipe.ingredients:
            return groups
    return [Group(title="", ingredients=recipe.ingredients)]


def phases_of(recipe: Recipe) -> list[Phase]:
    """The method's phases, or none."""
    items = _texts(recipe.phases, ("title", "time", "instructions"))
    if items is not None:
        phases = [
            Phase(title=item["title"], time=item["time"], instructions=item["instructions"])
            for item in items
        ]
        if join_instructions(phases) == recipe.instructions:
            return phases
    return []
