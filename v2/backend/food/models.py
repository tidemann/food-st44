from django.db import models
from django.utils import timezone


class Recipe(models.Model):
    """A recipe. Mirrors the live site's `recipes` table so ids and dates can be copied over."""

    id = models.AutoField(primary_key=True)
    title = models.TextField()
    ingredients = models.TextField()  # newline-separated lines
    instructions = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ("-created_at", "-id")

    def __str__(self) -> str:
        return self.title
