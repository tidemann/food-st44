# food.st44.no image: the v2 app, Angular SPA + Django API in one container (ADR 0002).
# Build from the repo root:  docker build -t food-v2 .
# It lives at the root because the shared deploy route (tidemann/deploy-workflows) builds
# ./Dockerfile with the repo root as context. The v1 Express image this replaced is in git
# history; reverting the switch-over commit brings it back (see DEPLOY.md, Rollback).
# Base images are pinned by digest so the same commit always produces the same artifact.

# --- 1. Angular build -------------------------------------------------------
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS frontend

WORKDIR /src/frontend
COPY v2/frontend/package.json v2/frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY v2/frontend/ ./
# The API types are generated from the backend's OpenAPI schema during the build.
COPY v2/backend/openapi.json ../backend/openapi.json
RUN npm run build

# --- 2. Django runtime ------------------------------------------------------
FROM python:3.13-slim@sha256:3dd7cc108ec1493442514f5c2a871af6af0ec31d768ff6e378a93340c3b3db5f

COPY --from=ghcr.io/astral-sh/uv:0.12.23@sha256:61d393e44e249f2e4b526b6c7ddcecce245946826e608e11c93ad4f5bba55b21 /uv /usr/local/bin/uv

# wget is part of the deploy contract, not a convenience: the host's deploy.sh gates every
# deploy on `docker exec food-st44 wget -qO- http://food-st44:80/healthz` (deploy-workflows
# README). The slim base has no wget, so without it that gate can never pass.
RUN apt-get update \
 && apt-get install -y --no-install-recommends wget \
 && rm -rf /var/lib/apt/lists/*

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1

WORKDIR /app/backend
COPY v2/backend/pyproject.toml v2/backend/uv.lock ./
RUN uv sync --locked --no-dev

COPY v2/backend/ ./
COPY --from=frontend /src/frontend/dist/frontend/browser /app/spa

ENV SPA_DIR=/app/spa \
    DJANGO_DB_PATH=/data/food.sqlite3

RUN useradd --system --no-create-home app && mkdir -p /data && chown app /data
USER app

EXPOSE 80

# start-period covers the entrypoint's migrate and the one-time v1 import.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1/healthz', timeout=2)"]

# The entrypoint migrates the database and, when V1_DB_PATH is set, copies the v1 recipes once.
# DJANGO_SECRET_KEY (or DJANGO_SECRET_KEY_FILE) must be set at run time; without either the app
# refuses to start.
# --no-control-socket: gunicorn's runtime control socket (gunicornc) is unused here, and its
# default path is under $HOME, which the `app` system user does not have.
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["gunicorn", "config.wsgi", "--bind", "0.0.0.0:80", "--workers", "2", "--access-logfile", "-", "--no-control-socket"]
