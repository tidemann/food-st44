# food.st44.no v2 image: Angular SPA + Django API in one container (ADR 0002).
# Build from the repo root:  docker build -t food-v2 v2
# Base images are pinned by digest so the same commit always produces the same artifact.

# --- 1. Angular build -------------------------------------------------------
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS frontend

WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
# The API types are generated from the backend's OpenAPI schema during the build.
COPY backend/openapi.json ../backend/openapi.json
RUN npm run build

# --- 2. Django runtime ------------------------------------------------------
FROM python:3.13-slim@sha256:3dd7cc108ec1493442514f5c2a871af6af0ec31d768ff6e378a93340c3b3db5f

COPY --from=ghcr.io/astral-sh/uv:0.12.23@sha256:61d393e44e249f2e4b526b6c7ddcecce245946826e608e11c93ad4f5bba55b21 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1

WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev

COPY backend/ ./
COPY --from=frontend /src/frontend/dist/frontend/browser /app/spa

ENV SPA_DIR=/app/spa \
    DJANGO_DB_PATH=/data/food.sqlite3

RUN useradd --system --no-create-home app && mkdir -p /data && chown app /data
USER app

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1/healthz', timeout=2)"]

# DJANGO_SECRET_KEY must be set at run time; the app refuses to start without it.
CMD ["gunicorn", "config.wsgi", "--bind", "0.0.0.0:80", "--workers", "2", "--access-logfile", "-"]
