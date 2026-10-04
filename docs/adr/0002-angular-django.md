# 2. Angular frontend and Django backend

## Status

Accepted (2026-10-04). Supersedes [ADR 0001](0001-stack.md).

## Context

ADR 0001 chose server-rendered EJS on Express because the MVP — add, list,
find, edit, delete recipes — had no interactivity that HTML forms couldn't do.
That was right for the MVP, and the MVP shipped.

The next features change the picture:

- **Recipe import from a photo** — snap a recipe on the phone, an AI vision
  model reads it, and the user reviews the result before saving.
- **Meal photos** — add photos of the finished dish from the phone.
- **Google login** with roles — editors can add and edit; everyone else can
  only read. Applies on all devices.
- **Cooking mode** on the phone — step by step, screen kept awake, timers.
- **Later:** showing a recipe on a smart display, which needs a JSON API that
  something other than the website can call.

Together these mean more client-side state (import review, cooking mode), an
app-like experience on the phone, and a JSON API as a first-class interface.

The code is written and maintained by autonomous agents (Finn, Frida, Kasper;
Lars reviews). So the deciding criterion for every choice below is: **what do
agents get right most reliably, and what stops them when they drift?** The
owner had no preference between frameworks and asked for the best fit for
agents.

## Decision

### Frontend: Angular, as a single-page app

- **Angular** (current major release), browser-only SPA. No SSR.
- **Strict TypeScript** and **angular-eslint** rules that fail CI on legacy
  patterns: standalone components only, signals for state, built-in control
  flow (`@if`/`@for`), no NgModules.
- **Styling:** the Søndag design stays plain CSS. The tokens and base
  typography become the global stylesheet; components get small scoped CSS
  files using those tokens. **stylelint** rejects any colour that isn't one of
  the six tokens. No Tailwind, no component library.
- **Link previews:** the backend injects title and photo meta tags into the
  SPA's `index.html` for `/recipes/:id`, so shared recipe links get a proper
  preview without SSR.

### Backend: Python, Django + Django Ninja

- **Django** (current release) with **Django Ninja** for the JSON API:
  Pydantic schemas per endpoint, automatic OpenAPI.
- The OpenAPI spec generates the TypeScript types the Angular app uses, so an
  API change breaks the frontend build rather than the running site.
- **SQLite** stays, on the existing volume. Django migrations own the schema.
- Django provides sessions, CSRF protection and the admin (a backstage for
  fixing imports and managing editors).
- **CI is strict from day one:** `uv` (locked dependencies), `ruff` (lint and
  format, including Django rules), `mypy --strict` with `django-stubs`,
  `pytest` + `pytest-django`.

### Deploy unit

Still **one image, one container**. A multi-stage Dockerfile builds the
Angular app with Node, then a Python image serves both the API and the built
frontend. The deploy contract is unchanged: immutable SHA tag, port 80 on
`st44_default`, `/healthz` returns 200.

### Agent kit

- **Official Angular skills** ([angular/skills](https://github.com/angular/skills)),
  pinned to one commit, installed in each food agent's Hermes skills folder
  (Finn, Frida, Kasper, Lars), refreshed together by one script.
- **An own lean `django-ninja` skill**, written from the official Django and
  Django Ninja docs, reviewed by the owner before install.
- **Vinta's `django-reviewer`** ([vintasoftware/django-ai-plugins](https://github.com/vintasoftware/django-ai-plugins),
  MIT) for Lars and Kasper.
- **A short `AGENTS.md`** in this repo with only food-specific rules (stack,
  Søndag design, lint rules). It does not repeat what the skills cover.

### Order of work

1. **Port first.** Rebuild today's screens on the new stack with the same look
   and behaviour. Done means "nothing changed" — easy to verify, easy to roll
   back.
2. **Then features**, starting with login, which touches every screen and is
   cheapest built once on the new stack.

## Consequences

- **Two languages in one repo** (TypeScript, Python). ADR 0001 rejected
  Python only as a tie-break to keep one language; with an Angular frontend
  that argument no longer holds. The owner also wants to learn Python.
- **A build step** returns (Angular build in the Docker image). Accepted:
  that's the price of a framework.
- **Library drift is minimised by design.** Angular and Django each ship
  routing/forms/auth/ORM as one coherent release with an official upgrade
  path (`ng update` rewrites code automatically), instead of a stack of
  independently versioned libraries.
- **Agent drift is caught mechanically.** Lint, strict types, the stylelint
  token rule and generated API types turn "the agent wrote it the old way"
  into a red CI with a precise message.
- Existing ADR 0001 decisions that still hold: SQLite on a volume, one
  container, no hosted backend, no paid service without the owner's approval.

## Open questions (for the owner interview)

Deliberately not decided here:

- How existing recipes and their photos move to the new app.
- Which AI vision provider reads recipe photos (a paid service — owner
  approval).
  *Stig (2026-10-04): no vendor lock-in — it must be possible to swap
  providers; ask Stig each time before anything is paid.*
- How uploaded photos are stored and served.
  *Stig (2026-10-04): stored on our own server, next to the database.*
- Feature details: roles and editor list, cooking mode, import review flow.
  *Stig (2026-10-04): editors are Stig and his household; everyone else
  reads only.*

## Options considered and rejected

**Frontend**

- **Keep EJS, add Alpine.js or htmx.** Right for the current features alone,
  but the owner expects rich client state, an app-like phone experience and
  a JSON API for other clients. Rejected.
- **React.** Most training data, but only a view library: routing, data
  fetching and forms come from separately versioned libraries that drift
  (React Router v5→v6→v7), and nothing flags an agent mixing their eras.
  Rejected.
- **Vue.** Official router and store, but two component styles (Options vs
  Composition API) that agents mix, and no automated migrations. Rejected.
- **Svelte.** Svelte 5 replaced its core syntax; models still mix 4 and 5.
  Rejected.
- **Angular SSR.** Faster first paint and link previews, but every
  browser-only feature (camera, wake lock, timers) must be guarded against
  running on the server — a classic agent bug. Link previews are solved more
  cheaply with meta-tag injection. Rejected.

**Backend**

- **Fastify + TypeScript + Zod.** Strong runner-up: one language, schemas
  shared with the frontend and with AI structured output. Not chosen because
  the owner prefers Python.
- **FastAPI.** Pydantic-native, but API-only: ORM, migrations and sessions
  come from separate libraries, and SQLAlchemy's 1.x/2.0 styles are a known
  agent trap. Rejected for the same reason as React.
- **Express 5 + TypeScript.** No built-in validation or typing; rails would
  have to be assembled. Rejected.
- **NestJS.** Angular-like and opinionated, but too much ceremony for an app
  this size. Rejected.

## References

- [ADR 0001](0001-stack.md) — the stack this supersedes
- [Angular agent skills](https://angular.dev/ai/agent-skills)
- [Django Ninja](https://django-ninja.dev/)
