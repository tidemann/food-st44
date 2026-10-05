# AGENTS.md — food.st44.no

Food-specific rules only. Angular practice comes from the angular/skills pack, Django Ninja
practice from the `django-ninja` skill; this file does not repeat them. Decision record:
ADR 0002 (Angular + Django).

## Two apps in one repo

| Path | What | Status |
|---|---|---|
| `v2/`, `Dockerfile`, `infra/` | Angular + Django app | **Live** on food.st44.no. All new work goes here. A merge to `main` that touches these deploys. |
| `src/`, `views/`, `public/` | Express + EJS site (v1) | Retired; kept for reference and rollback (DEPLOY.md). Not in the image. |

```
Dockerfile                one image from the repo root: Angular build stage → Python runtime
infra/                    the deploy compose file; smoke-deploy.sh runs it in CI
v2/
  backend/                Django + Django Ninja, managed by uv
    config/               settings, urls, wsgi
    docker-entrypoint.sh  container start: secret key, migrate, one-time v1 import
    food/                 the app: api.py (NinjaAPI), views.py (SPA fallback, /healthz)
    tests/                pytest + pytest-django
    openapi.json          exported API schema — committed, CI checks it is current
  frontend/               Angular (standalone, signals, zoneless)
    src/styles.css        Søndag fonts, the six colour tokens, base type
    src/app/api/types.ts  named aliases over generated API types
    stylelint/            the sondag/palette rule and its self-test
.github/workflows/v2.yml  CI for v2/ (ci.yml keeps guarding the live site)
```

## Commands

Backend (`cd v2/backend`):

```bash
uv sync                          # install from uv.lock
uv run ruff format . && uv run ruff check .
uv run mypy .                    # --strict + django-stubs
uv run pytest
DJANGO_DEBUG=1 uv run python manage.py runserver
uv run python manage.py export_openapi_schema --api food.api.api --indent 2 --output openapi.json
```

Frontend (`cd v2/frontend`):

```bash
npm ci
npm run lint        # angular-eslint + typescript-eslint strictTypeChecked
npm run lint:css    # stylelint incl. sondag/palette
npm test            # vitest
npm run build       # regenerates API types first (prebuild)
npm start           # dev server; run the backend alongside it
```

Image (from the repo root): `docker build -t food-v2 . && docker run --rm -p 8080:80 -e DJANGO_SECRET_KEY=dev food-v2`,
then `curl localhost:8080/healthz`. `infra/smoke-deploy.sh food-v2` runs it through the deploy
compose file with a v1 volume (CI only, never on the server).

## Deploy

Every push to `main` that touches `v2/**`, `Dockerfile` or `infra/**` deploys live
(`.github/workflows/deploy.yml`). The old `v2/**` paths-ignore is gone, so a v2 merge is no
longer safe. Only Markdown, `docs/**` and the retired v1 paths skip the deploy. Do not merge
without Maria's go. The host `deploy.sh` gate runs
`docker exec food-st44 wget -qO- http://food-st44:80/healthz` and expects `ok`, so the
runtime image must ship `wget` (`infra/smoke-deploy.sh` runs the same probe in CI).

## Rules CI enforces

Everything in `.github/workflows/v2.yml` must be green. Do not weaken a rule, add an ignore,
or a `# type: ignore` / `eslint-disable` to get green — fix the code. If a rule is wrong, say
so on the task.

- **API contract.** The frontend never hand-writes an API type. Change the Ninja schema,
  re-export `openapi.json`, and import from `src/app/api/types.ts`. A stale `openapi.json` fails
  CI; a breaking API change fails `ng build`.
- **URLs.** `/healthz` stays at the root and answers plain `ok` (deploy contract: the public gate
  compares the body). Every other endpoint lives under
  `/api/` (`api.add_router("/api/…", router)`). Any other path serves the SPA.
- **Python.** Fully typed (`mypy --strict`); ruff rules in `pyproject.toml`. Dependencies only
  via `uv add`, so `uv.lock` is always committed with them.
- **Angular.** Standalone components, signals (`input()`, `output()`, `viewChild()`…),
  `@if`/`@for`, `inject()`, OnPush, zoneless. No NgModules, `CommonModule`, `*ngIf`/`*ngFor`,
  decorators like `@Input`, or experimental / developer-preview APIs. Strict TS and strict
  templates.

## Design: Søndag

The look is Søndag (Bodoni Moda display, Archivo interface). **Six colours, no others:**

| Token | Value |
|---|---|
| `--paper` | `#FBFAF7` |
| `--ink` | `#14110E` |
| `--soft` | `#5B544C` |
| `--rule` | `#DED8CE` |
| `--red` | `#A4142E` |
| `--tint` | `#F2EFE8` |

They are defined once, in `v2/frontend/src/styles.css`. Component CSS uses `var(--token)`;
hex, `rgb()`/`hsl()`/`oklch()`/`color-mix()` and named colours fail stylelint. Plain CSS
only: no Tailwind, Sass or component library. A new colour is a design decision for Maria,
not something to add to get CI green.

## Runtime settings

`DJANGO_SECRET_KEY` (required unless `DJANGO_DEBUG=1`, or set `DJANGO_SECRET_KEY_FILE` and the
entrypoint creates and reads that file), `DJANGO_ALLOWED_HOSTS` (comma-separated),
`DJANGO_DB_PATH` (SQLite file, `/data/food.sqlite3` in the image), `SPA_DIR` (built Angular
app), `V1_DB_PATH` (v1 `recipes.db`; imported once on start, see `docker-entrypoint.sh`).
Sign-in: `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (without both the site is read-only),
`GOOGLE_REDIRECT_URI` (defaults to the food.st44.no callback, or localhost:8000 with
`DJANGO_DEBUG=1`), `FOOD_ADMIN_EMAILS` (comma-separated: always editors, and the only accounts
that can open `/api/admin/` to manage the editor list), `DJANGO_CSRF_TRUSTED_ORIGINS`.
Production values are in `infra/docker-compose.yml`.
