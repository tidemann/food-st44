from django.db import models
from django.utils import timezone


class Tag(models.Model):
    """An "emneord" on recipes (ST-784), stored as food.tags.normalise leaves it: lower case,
    trimmed, at most food.tags.MAX_CHARS. A tag no recipe carries any more is deleted."""

    name = models.CharField(max_length=24, unique=True)

    def __str__(self) -> str:
        return self.name


class Recipe(models.Model):
    """A recipe. Mirrors the live site's `recipes` table so ids and dates can be copied over."""

    id = models.AutoField(primary_key=True)
    title = models.TextField()
    ingredients = models.TextField()  # newline-separated lines
    instructions = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)
    # The file name of the recipe's one photo in settings.PHOTOS_DIR; "" when it has none.
    photo = models.CharField(max_length=100, blank=True, default="")
    tags = models.ManyToManyField(Tag, blank=True, related_name="recipes")

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
    """One recipe read sent to a provider (food.reader), from a photo or from pasted text (M5),
    so the admin can count them against the cost. Only who, when, what, which provider and how it
    went: the photo or the text itself is never stored."""

    class Kind(models.TextChoices):
        PHOTO = "photo", "bilde"
        TEXT = "text", "tekst"

    class Outcome(models.TextChoices):
        READ = "read", "lest"
        UNREADABLE = "unreadable", "kunne ikke leses"
        FAILED = "failed", "feil hos leverandøren"

    at = models.DateTimeField(default=timezone.now, verbose_name="tidspunkt")
    editor = models.EmailField(blank=True, verbose_name="redaktør")
    kind = models.CharField(
        max_length=10, choices=Kind.choices, default=Kind.PHOTO, verbose_name="fra"
    )
    provider = models.CharField(max_length=40, verbose_name="leverandør")
    model = models.CharField(max_length=200, blank=True, verbose_name="modell")
    outcome = models.CharField(max_length=20, choices=Outcome.choices, verbose_name="resultat")

    class Meta:
        ordering = ("-at",)
        verbose_name = "lesing med KI"
        verbose_name_plural = "lesinger med KI"

    def __str__(self) -> str:
        return f"{self.at:%Y-%m-%d %H:%M} {self.kind} {self.provider}: {self.outcome}"
