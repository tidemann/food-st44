from django.db import transaction
from django.db.models import Count

from food import photos
from food.models import Recipe, Tag
from food.tags import normalise, normalise_one, sort_names


def search_recipes(q: str = "", tag: str = "") -> list[Recipe]:
    """Newest first. A non-blank `q` keeps recipes whose title contains it, ignoring case; a
    non-blank `tag` keeps the ones that carry it. Given both, a recipe must match both.

    Title only, as on the live site (inventory §3.1). Filtered in Python rather than with
    `icontains`, because SQLite's LIKE only folds ASCII case and "KJØTT" must find "Kjøttkaker".
    """
    recipes = Recipe.objects.prefetch_related("tags")
    if tag.strip():
        recipes = recipes.filter(tags__name=normalise_one(tag))
    needle = q.strip().lower()
    if not needle:
        return list(recipes)
    return [recipe for recipe in recipes if needle in recipe.title.lower()]


def tags_in_use() -> list[dict[str, object]]:
    """Every tag at least one recipe carries, with how many, in Norwegian order."""
    counted = Tag.objects.annotate(count=Count("recipes")).filter(count__gt=0)
    by_name = {tag.name: tag.count for tag in counted}
    return [{"name": name, "count": by_name[name]} for name in sort_names(by_name)]


def tag_names(recipe: Recipe) -> list[str]:
    return sort_names(tag.name for tag in recipe.tags.all())


def _set_tags(recipe: Recipe, names: list[str]) -> None:
    recipe.tags.set([Tag.objects.get_or_create(name=name)[0] for name in normalise(names)])


def _drop_unused_tags() -> None:
    """A tag with no recipes left goes, so the list and the suggestions offer only real ones."""
    Tag.objects.filter(recipes=None).delete()


@transaction.atomic
def create_recipe(
    *, title: str, ingredients: str, instructions: str, tags: list[str] | None = None
) -> Recipe:
    recipe = Recipe.objects.create(title=title, ingredients=ingredients, instructions=instructions)
    _set_tags(recipe, tags or [])
    return recipe


@transaction.atomic
def update_recipe(
    recipe: Recipe,
    *,
    title: str,
    ingredients: str,
    instructions: str,
    tags: list[str] | None = None,
) -> Recipe:
    """An edit replaces the text and the tags; `created_at` stays as it was."""
    recipe.title = title
    recipe.ingredients = ingredients
    recipe.instructions = instructions
    recipe.save(update_fields=["title", "ingredients", "instructions"])
    _set_tags(recipe, tags or [])
    _drop_unused_tags()
    return recipe


def delete_recipe(recipe: Recipe) -> None:
    """The recipe, any tag only it carried, and its photo file."""
    with transaction.atomic():
        recipe.delete()
        _drop_unused_tags()
    photos.forget(recipe)
