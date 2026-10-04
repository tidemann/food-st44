from datetime import UTC, datetime, timedelta

import pytest
from django.core.management import call_command

from food.models import Recipe

pytestmark = pytest.mark.django_db


def test_recipe_round_trips() -> None:
    created = Recipe.objects.create(
        title="Fiskesuppe", ingredients="1 l kraft\n400 g torsk", instructions="Kok opp."
    )

    recipe = Recipe.objects.get(pk=created.pk)

    assert recipe.title == "Fiskesuppe"
    assert recipe.ingredients == "1 l kraft\n400 g torsk"
    assert recipe.instructions == "Kok opp."
    assert recipe.created_at is not None
    assert str(recipe) == "Fiskesuppe"


def test_instructions_default_to_empty_string() -> None:
    created = Recipe.objects.create(title="Brød", ingredients="mel\nvann")

    assert Recipe.objects.get(pk=created.pk).instructions == ""


def test_newest_first_then_highest_id() -> None:
    now = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)
    old = Recipe.objects.create(title="old", ingredients="x", created_at=now - timedelta(days=1))
    same_a = Recipe.objects.create(title="same a", ingredients="x", created_at=now)
    same_b = Recipe.objects.create(title="same b", ingredients="x", created_at=now)

    assert list(Recipe.objects.all()) == [same_b, same_a, old]


def test_explicit_id_is_kept() -> None:
    # The import from the live site copies ids over.
    Recipe.objects.create(id=42, title="Imported", ingredients="x")

    assert Recipe.objects.get(pk=42).title == "Imported"


def test_models_and_migrations_agree() -> None:
    call_command("makemigrations", "--check", "--dry-run", verbosity=0)
