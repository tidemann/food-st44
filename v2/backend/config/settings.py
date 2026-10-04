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
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "ninja",
    "food",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.environ.get("DJANGO_DB_PATH", str(BASE_DIR / "db.sqlite3")),
    }
}

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
