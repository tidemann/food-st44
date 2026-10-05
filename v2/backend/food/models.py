from django.db import models
from django.utils import timezone


class Recipe(models.Model):
    """A recipe. Mirrors the live site's `recipes` table so ids and dates can be copied over."""

    id = models.AutoField(primary_key=True)
    title = models.TextField()
    ingredients = models.TextField()  # newline-separated lines
    instructions = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)
    # The file name of the recipe's one photo in settings.PHOTOS_DIR; "" when it has none.
    photo = models.CharField(max_length=100, blank=True, default="")

    class Meta:
        ordering = ("-created_at", "-id")

    def __str__(self) -> str:
        return self.title


class Editor(models.Model):
    """A household member who may add, edit and delete recipes: a Google account's email.
    Managed in the admin. Everyone else, signed in or not, can only read."""

    email = models.EmailField(unique=True, verbose_name="e-post")
    name = models.CharField(max_length=100, blank=True, verbose_name="navn")
    added_at = models.DateTimeField(default=timezone.now, verbose_name="lagt til")

    class Meta:
        ordering = ("email",)
        verbose_name = "redaktør"
        verbose_name_plural = "redaktører"

    def __str__(self) -> str:
        return self.email

    def clean(self) -> None:
        # Google's addresses are compared lower-case (food.google); store them that way.
        self.email = self.email.strip().lower()


class PhotoRead(models.Model):
    """One "read recipe from photo" sent to a provider (food.reader), so the admin can count
    them against the cost per photo. Only who, when, which provider and how it went: the photo
    itself is never stored."""

    class Outcome(models.TextChoices):
        READ = "read", "lest"
        UNREADABLE = "unreadable", "kunne ikke leses"
        FAILED = "failed", "feil hos leverandøren"

    at = models.DateTimeField(default=timezone.now, verbose_name="tidspunkt")
    editor = models.EmailField(blank=True, verbose_name="redaktør")
    provider = models.CharField(max_length=40, verbose_name="leverandør")
    model = models.CharField(max_length=200, blank=True, verbose_name="modell")
    outcome = models.CharField(max_length=20, choices=Outcome.choices, verbose_name="resultat")

    class Meta:
        ordering = ("-at",)
        verbose_name = "lesing fra bilde"
        verbose_name_plural = "lesinger fra bilde"

    def __str__(self) -> str:
        return f"{self.at:%Y-%m-%d %H:%M} {self.provider}: {self.outcome}"
