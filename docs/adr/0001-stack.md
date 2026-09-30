# 1. Stack for food.st44.no

## Status

Accepted

## Context

`food.st44.no` is moving from a placeholder static page to the real MVP
described in Nora's [product brief](/ST/issues/ST-93#document-brief): a
single household adds, lists, finds, edits, and deletes recipes. Norwegian
UI, no accounts, no login — read and write are both open to anyone who
reaches the site.

Constraints that are not mine to change:

- One container image per release, built by CI and pushed by Oskar's deploy
  pipeline as an immutable `ghcr.io/tidemann/food-st44:<commit-sha>` tag —
  never `latest`.
- The container runs on the shared Docker network `st44_default`, with no
  published host ports. `nginx-proxy` reaches it at `http://food-st44:80`
  (see `infra/docker-compose.yml`), so the app must listen on port 80.
- `/healthz` must return 200 when the app is up; the deploy is not
  considered green until `https://food.st44.no/healthz` answers 200 over
  TLS.
- CI runs in GitHub Actions (`.github/workflows/ci.yml`), currently
  validate → build → smoke-test, no publish step.
- No paid service, no new hosting, no new domain, no new third-party
  account without the owner's approval (asked through Maria).

The current `infra/docker-compose.yml` declares the service stateless (no
volumes). A CRUD recipe app needs to persist data across restarts and
redeploys, which this decision has to account for.

Traffic is one household. This is not a scale problem; it's a "don't build
more than the job needs" problem.

## Decision

- **Runtime:** Node.js 22 (LTS) + Express.
- **Rendering:** server-rendered HTML with EJS templates. No client-side
  framework, no bundler, no build step — the app serves the HTML it
  renders directly.
- **Data:** SQLite, accessed via `better-sqlite3`, as a single file on a
  named Docker volume mounted into the container (e.g. `/data/recipes.db`).
- **Styling:** one plain CSS file, no preprocessor, no framework.
- **Tests:** Node's built-in test runner (`node:test`) plus `supertest` for
  HTTP-level route tests.
- **Container:** single-stage `Dockerfile` based on `node:22-alpine`. No
  build stage is needed because there is no bundler — `npm ci --omit=dev`
  and run.
- **CI:** extend the existing `ci.yml` pattern (validate → `npm ci` →
  `npm test` → build image → smoke-test `/healthz`), still publishing
  nothing.

This replaces the current nginx-serving-static-files `Dockerfile` and
`nginx.conf` with a Node process that serves both the pages and
`/healthz` itself; nginx-proxy in front is unaffected.

## Consequences

- **Needs a persistent volume.** Today's `infra/docker-compose.yml` has no
  `volumes:` entry because the static site was stateless. The real app is
  not. This is a deploy-pipeline change, not an app-repo change, so it
  belongs to Oskar — flagged separately, not made here.
- **`nginx.conf` and the current `Dockerfile` go away** once the app PRs
  land; they're replaced by the Node `Dockerfile`. The healthz contract
  (`GET /healthz` → 200) stays the same, just served by the app instead of
  nginx.
- Single SQLite file is easy to back up (copy one file) and easy to reason
  about, at the cost of not scaling past one writer process — a non-issue
  at household scale and explicitly out of scope to solve for now.

## Options considered and rejected

- **Next.js / React SPA.** More moving parts than six CRUD screens need: a
  build step, hydration, client routing, a much bigger dependency tree for
  three Hermes builders (and Lars) to keep working. Rejected — boring
  beats clever, and there is no interactivity here that server-rendered
  HTML + forms can't do.
- **Postgres or MySQL as a second container.** Violates "one container
  image per release" in spirit even if technically a second image: a
  second service to deploy, network, back up, and keep alive for one
  household's recipes. SQLite in the same container is enough. Rejected.
- **Python (Flask/FastAPI) + Jinja2 + SQLite.** An equally boring, equally
  valid choice — rejected only as a tie-break, to keep one language across
  backend and templates so the full-stack and frontend builders aren't
  switching ecosystems mid-feature. Not a technical objection to Python.
- **Any hosted backend (Firebase, Supabase, a managed Postgres, etc.).**
  New third-party account / paid service. Explicitly disallowed without
  owner approval through Maria, and unnecessary here. Rejected.
- **Deno or Bun as the runtime.** Smaller ecosystems and less prior art for
  the exact "small CRUD app in a single container" shape than Node has.
  More risk for autonomous builders leaning on documentation and examples
  they can actually find. Rejected.
- **Static site + client-side JS calling some backend.** There is no
  backend to call without standing one up, which is the actual decision
  being made here — this option just defers the same question. Rejected.

## References

- Product brief: [ST-93](/ST/issues/ST-93#document-brief)
- Branch protection on `main`: [ST-85](/ST/issues/ST-85)
- Builder handbook: [ST-94](/ST/issues/ST-94#document-handbook)
