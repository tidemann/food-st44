"""Django settings for food.st44.no v2. Everything that differs per environment is an env var."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

DEBUG = os.environ.get("DJANGO_DEBUG") == "1"

# Required outside DEBUG: an image that starts without a key must fail loudly, not run insecurely.
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-insecure-key" if DEBUG else "")

ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "food.st44.no,localhost,127.0.0.1").split(
    ","
)

INSTALLED_APPS = [
    # SimpleAdminConfig: no autodiscover, so food.admin.site is the only admin.
    "django.contrib.admin.apps.SimpleAdminConfig",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "ninja",
    "food",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# Only the admin renders Django templates; the site itself is the SPA.
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.environ.get("DJANGO_DB_PATH", str(BASE_DIR / "db.sqlite3")),
    }
}

# --- Recipe photos (food.photos) ---

# Next to the database by default (/data/photos in the image), so the data volume and its backup
# hold both. The app serves them itself at /photos/<name>.
PHOTOS_DIR = Path(
    os.environ.get("FOOD_PHOTOS_DIR", str(Path(DATABASES["default"]["NAME"]).parent / "photos"))
)
# A phone photo is often 5 to 15 MB; anything up to this is accepted and resized on save.
PHOTO_MAX_UPLOAD_BYTES = 25 * 1024 * 1024

# --- Reading a recipe from a photo (food.reader) ---

# Which provider reads the photo: "off" (no button, the API answers 503), "fake" (a fixed
# recipe, for tests and a local demo), "anthropic" (Claude, Anthropic's Messages API) or
# "openai_compatible" (any chat API that takes images in OpenAI's format: OpenAI, a hosted
# gateway, or a local model behind Ollama or llama.cpp). Switching is a setting and a restart.
# Off by default: nothing is paid for until it is chosen. In production these come from the
# optional /srv/apps/food-st44/food-ai.env (infra/docker-compose.yml).
FOOD_AI_PROVIDER = os.environ.get("FOOD_AI_PROVIDER", "off")
# For openai_compatible: the API root (the part before /chat/completions). Not used by anthropic.
FOOD_AI_BASE_URL = os.environ.get("FOOD_AI_BASE_URL", "")
# The model (for anthropic, empty means claude-haiku-4-5) and the key (anthropic needs one).
FOOD_AI_MODEL = os.environ.get("FOOD_AI_MODEL", "")
FOOD_AI_API_KEY = os.environ.get("FOOD_AI_API_KEY", "")
# Seconds to wait for the provider. Below gunicorn's 30 s worker timeout, so the editor always
# gets an answer, and in under 30 s.
FOOD_AI_TIMEOUT = float(os.environ.get("FOOD_AI_TIMEOUT", "25"))
# What one photo costs with the chosen provider, as text for the admin (e.g. "ca. 0,01 kr").
# Unset with anthropic and its default model, the admin shows "ca. $0.007 per bilde".
FOOD_AI_COST_PER_PHOTO = os.environ.get("FOOD_AI_COST_PER_PHOTO", "")

LANGUAGE_CODE = "nb"
TIME_ZONE = "Europe/Oslo"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"

# The built Angular app. WhiteNoise serves its files at the site root; food.views.spa serves
# index.html for every other non-API path so client-side routes survive a reload.
SPA_DIR = Path(os.environ.get("SPA_DIR", str(BASE_DIR.parent / "frontend/dist/frontend/browser")))
WHITENOISE_ROOT = SPA_DIR if SPA_DIR.is_dir() else None

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# The admin's own CSS and JS: WhiteNoise serves them straight from the installed apps, so the
# image needs no collectstatic step. It is a few hundred small files, indexed once at start.
WHITENOISE_USE_FINDERS = True

# --- Sign-in (food.auth, food.google) ---

# A Google OAuth "Web application" client. Without both, the site runs read-only: /api/auth/me
# says sign_in_available=false and nobody can change recipes.
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
# Must match an "Authorized redirect URI" on the client exactly.
GOOGLE_REDIRECT_URI = os.environ.get(
    "GOOGLE_REDIRECT_URI",
    "http://localhost:8000/api/auth/google/callback"
    if DEBUG
    else "https://food.st44.no/api/auth/google/callback",
)
# Comma-separated. Always editors, and the only accounts that can open /api/admin/ to manage
# the editor list. Stig's address goes here.
FOOD_ADMIN_EMAILS = os.environ.get("FOOD_ADMIN_EMAILS", "").split(",")

# The session cookie a sign-in sets. A household signs in rarely: keep it for 90 days.
SESSION_COOKIE_AGE = 90 * 24 * 60 * 60
SESSION_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"  # sent on Google's top-level redirect back to the callback

# CSRF on recipe writes, named the way Angular's HttpClient already reads and sends it.
CSRF_COOKIE_NAME = "XSRF-TOKEN"
CSRF_HEADER_NAME = "HTTP_X_XSRF_TOKEN"
CSRF_COOKIE_SECURE = not DEBUG
# TLS ends at nginx-proxy, so Django sees http; the browser's Origin is the https site.
CSRF_TRUSTED_ORIGINS = os.environ.get(
    "DJANGO_CSRF_TRUSTED_ORIGINS", "http://localhost:4200" if DEBUG else "https://food.st44.no"
).split(",")
