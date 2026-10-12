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


class ApiKey(models.Model):
    """A personal key an editor makes for one assistant (ST-833), sent as
    `Authorization: Bearer <token>` to /api/mcp. Only the token's SHA-256 is stored; the token
    itself is shown once, when it is made. A deleted key is kept, marked, so the change log
    still names it; it opens nothing any more. A key writes only while its user is an editor."""

    user = models.ForeignKey(
        "auth.User", on_delete=models.CASCADE, related_name="api_keys", verbose_name="konto"
    )
    name = models.CharField(max_length=40, verbose_name="navn")
    token_hash = models.CharField(max_length=64, unique=True, editable=False)
    # The start of the token ("food_sk_7Qd4"), so a key can be told apart whatever its name.
    prefix = models.CharField(max_length=16, editable=False, verbose_name="starter med")
    created_at = models.DateTimeField(default=timezone.now, verbose_name="laget")
    last_used_at = models.DateTimeField(null=True, blank=True, verbose_name="sist brukt")
    deleted_at = models.DateTimeField(null=True, blank=True, verbose_name="slettet")

    class Meta:
        ordering = ("-created_at", "-id")
        verbose_name = "nøkkel"
        verbose_name_plural = "nøkler"

    def __str__(self) -> str:
        return f"{self.name} ({self.prefix}…)"


class McpChange(models.Model):
    """One recipe an assistant created or changed through /api/mcp (ST-833): who, through which
    key (or "Claude app"), which tool, which recipe, when, and which fields. Read in the admin."""

    at = models.DateTimeField(default=timezone.now, verbose_name="tidspunkt")
    user = models.ForeignKey(
        "auth.User", on_delete=models.SET_NULL, null=True, related_name="+", verbose_name="konto"
    )
    # The key's name, or "Claude app" for the app's sign-in (part 2).
    via = models.CharField(max_length=40, verbose_name="via")
    tool = models.CharField(max_length=40, verbose_name="verktøy")
    # Not a foreign key: the row outlives a recipe deleted on the site.
    recipe_id = models.IntegerField(verbose_name="oppskrift")
    summary = models.CharField(max_length=200, verbose_name="endret")

    class Meta:
        ordering = ("-at", "-id")
        verbose_name = "endring fra assistent"
        verbose_name_plural = "endringer fra assistenter"

    def __str__(self) -> str:
        return f"{self.at:%Y-%m-%d %H:%M} {self.tool} #{self.recipe_id}: {self.summary}"


class ClientRegistration(models.Model):
    """One app that registered itself at /api/oauth/register/ (ST-919), by the address it came
    from. Registration is open, and each one stores an application, so food.oauth lets one
    address register only so many times an hour. Rows older than that hour are deleted on the
    next registration."""

    ip = models.GenericIPAddressField()
    at = models.DateTimeField(default=timezone.now)

    class Meta:
        indexes = (models.Index(fields=("ip", "at")),)

    def __str__(self) -> str:
        return f"{self.at:%Y-%m-%d %H:%M} {self.ip}"
