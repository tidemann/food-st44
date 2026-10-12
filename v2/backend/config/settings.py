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
    "oauth2_provider",
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

# --- Importing a recipe from a link (food.importer) ---

# Seconds for the whole fetch, redirects included: well below gunicorn's 30 s worker timeout.
FOOD_IMPORT_TIMEOUT = float(os.environ.get("FOOD_IMPORT_TIMEOUT", "10"))
# The most of a page we read (after decompression). A recipe page with all its scripts is
# rarely over 1 MB.
FOOD_IMPORT_MAX_BYTES = 5 * 1024 * 1024

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

# --- The MCP server (food.mcp) ---

# The site's own address, for the recipe links the assistant tools answer with. TLS ends at
# nginx-proxy, so Django cannot tell it from the request.
FOOD_SITE_URL = os.environ.get(
    "FOOD_SITE_URL", "http://localhost:8000" if DEBUG else "https://food.st44.no"
).rstrip("/")

# --- The Claude app's sign-in to the MCP server (food.oauth, ST-834) ---

# OAuth 2.1 as the MCP spec asks, by django-oauth-toolkit: the app registers itself (RFC 7591),
# sends the person through Google sign-in and one approval page, and gets an access token for
# an hour and a refresh token that is replaced on every use. Only hashes of the tokens are
# stored. The addresses are built from FOOD_SITE_URL, not the request: TLS ends at nginx-proxy,
# so Django sees http.
MCP_RESOURCE = f"{FOOD_SITE_URL}/api/mcp"
OAUTH2_PROVIDER = {
    "SCOPES": {
        "read": "Søke i og lese oppskriftene",
        "write": "Legge inn og endre oppskrifter",
    },
    "DEFAULT_SCOPES": ["read"],
    "ACCESS_TOKEN_EXPIRE_SECONDS": 60 * 60,
    "REFRESH_TOKEN_EXPIRE_SECONDS": 90 * 24 * 60 * 60,  # as long as a site sign-in lasts
    "ROTATE_REFRESH_TOKEN": True,
    # A refresh token used twice means it leaked: the whole chain is revoked.
    "REFRESH_TOKEN_REUSE_PROTECTION": True,
    "PKCE_REQUIRED": True,
    # Claude's callback is https. Plain http only for a local run.
    "ALLOWED_REDIRECT_URI_SCHEMES": ["https", "http"] if DEBUG else ["https"],
    # The app registers itself; nothing is open to it until a person approves.
    "DCR_ENABLED": True,
    "DCR_REGISTRATION_PERMISSION_CLASSES": ("oauth2_provider.dcr.AllowAllDCRPermission",),
    # RFC 9700: no implicit or password grant, no "plain" PKCE, no token in the query string,
    # `iss` in the authorization response, tokens hashed at rest.
    "COMPLIANT_BCP_RFC9700_IMPLICIT_GRANT": True,
    "COMPLIANT_BCP_RFC9700_PASSWORD_GRANT": True,
    "COMPLIANT_BCP_RFC9700_PKCE_METHOD": True,
    "COMPLIANT_BCP_RFC9700_ACCESS_TOKEN_TRANSPORT": True,
    "COMPLIANT_BCP_RFC9700_AUTHZ_RESPONSE_ISS": True,
    "COMPLIANT_BCP_RFC9700_TOKEN_STORAGE": True,
    # Authorization-server metadata (RFC 8414) at /.well-known/oauth-authorization-server.
    "OIDC_ISS_ENDPOINT": FOOD_SITE_URL,
    "OAUTH2_RESPONSE_TYPES_SUPPORTED": ["code"],
    "OAUTH2_GRANT_TYPES_SUPPORTED": ["authorization_code", "refresh_token"],
    "OAUTH2_TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED": [
        "none",
        "client_secret_post",
        "client_secret_basic",
    ],
    # Protected-resource metadata (RFC 9728) at /.well-known/oauth-protected-resource.
    "OAUTH2_PROTECTED_RESOURCE_IDENTIFIER": MCP_RESOURCE,
    "OAUTH2_PROTECTED_RESOURCE_AUTHORIZATION_SERVERS": [FOOD_SITE_URL],
    "OAUTH2_PROTECTED_RESOURCE_NAME": "food.st44.no",
    "OAUTH2_PROTECTED_RESOURCE_DOCUMENTATION": f"{FOOD_SITE_URL}/assistent",
}
# Open registration stores an application each time, so one address may register this many
# apps an hour; the next gets 429 (food.oauth.Register, ST-919).
OAUTH_REGISTRATIONS_PER_HOUR = 10
# The authorize step sends someone who is not signed in through Google sign-in and back.
LOGIN_URL = "/api/auth/google/login"

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
