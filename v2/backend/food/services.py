from food.models import Recipe


def search_recipes(q: str = "") -> list[Recipe]:
    """Newest first. A non-blank `q` keeps recipes whose title contains it, ignoring case.

    Title only, as on the live site (inventory §3.1). Filtered in Python rather than with
    `icontains`, because SQLite's LIKE only folds ASCII case and "KJØTT" must find "Kjøttkaker".
    """
    recipes = list(Recipe.objects.all())
    needle = q.strip().lower()
    if not needle:
        return recipes
    return [recipe for recipe in recipes if needle in recipe.title.lower()]


def create_recipe(*, title: str, ingredients: str, instructions: str) -> Recipe:
    return Recipe.objects.create(title=title, ingredients=ingredients, instructions=instructions)


def update_recipe(recipe: Recipe, *, title: str, ingredients: str, instructions: str) -> Recipe:
    """An edit replaces the text; `created_at` stays as it was."""
    recipe.title = title
    recipe.ingredients = ingredients
    recipe.instructions = instructions
    recipe.save(update_fields=["title", "ingredients", "instructions"])
    return recipe
