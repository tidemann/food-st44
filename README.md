# food-st44

The website for **https://food.st44.no**.

> **The live site is the v2 app in `v2/`** (Angular + Django, [ADR 0002](docs/adr/0002-angular-django.md)),
> built by the root `Dockerfile`. See `AGENTS.md` for how to work on it and `DEPLOY.md` for the
> deploy and rollback. The rest of this README describes the retired v1 Express site, which is
> kept for reference; its `Dockerfile` is in git history.

A server-rendered recipe app for one household: Node.js 22 + Express, EJS
templates, SQLite. See [ADR 0001](docs/adr/0001-stack.md) for the stack
decision.

## Layout

| Path                       | What it is                                      |
| --------------------------- | ------------------------------------------------ |
| `src/server.js`            | Express app entrypoint. Listens on `process.env.PORT` (default `3000`). |
| `src/db.js`                | Opens the SQLite file and creates the `recipes` table if missing. |
| `src/view-model.js`        | Turns a stored recipe into what the pages show: amount column, numbered steps, photograph, meta line. |
| `views/*.ejs`              | Server-rendered HTML templates. `partials/` holds the masthead, footer and flash. |
| `public/style.css`         | The one CSS file — no preprocessor, no framework. |
| `public/fonts/`            | Bodoni Moda and Archivo, self-hosted. No third-party font request. |
| `public/img/recipes/`      | One photograph per recipe, named after its title. See the [README there](public/img/recipes/README.md). |
| `data/`                    | Local dev SQLite file (gitignored). In the container this path is a mounted volume. |
| `test/*.test.js`           | Tests: `node --test` + `supertest`.              |
| `Dockerfile`               | Single-stage `node:22-alpine` image.             |
| `.github/workflows/ci.yml` | Validate → build → smoke test → push to GHCR.    |
| `.github/workflows/deploy.yml` | Ships the compose file to the server over SSH and runs it. |
| `infra/docker-compose.yml` | The deploy unit: which image tag runs, on which network. |
| `DEPLOY.md`                | How the deploy works, its prerequisites, and how to roll back. |
| `docs/adr/`                | Architecture decision records.                   |

## The design

The front end is **Søndag**, the Nordic food-magazine direction Stig picked on
[ST-272](https://paperclip.st44.no/ST/issues/ST-272). Bodoni Moda for display and
Archivo for interface; paper `#FBFAF7`, ink `#14110E`, muted ink `#5B544C`, rule
`#DED8CE`, crimson `#A4142E`, tint `#F2EFE8`. Those six values are CSS custom
properties at the top of `public/style.css` and are the only colours used.

The front page opens on the most recently added dish with the whole collection
as a register beside it. A search replaces that opening with a plain list of
hits — the front page chooses a dish for you, a search must not.

## Run it locally

With Docker (matches production):

```bash
docker build -t food-st44:dev .
docker run --rm -p 8080:80 -e PORT=80 -v "$(pwd)/data:/data" food-st44:dev
```

Then open http://localhost:8080 — and http://localhost:8080/healthz should
return `ok`.

Without Docker (faster iteration), with Node.js 22+ installed:

```bash
npm install
npm run dev
```

Then open http://localhost:3000 — `npm run dev` restarts automatically on
file changes. http://localhost:3000/healthz should return `ok`.

Run the tests with:

```bash
npm test
```

## How it deploys

1. You open a pull request against `main`. CI checks the sources, builds the
   image, and runs it to confirm `/healthz` answers. Nothing is published — CI
   never pushes.
2. The pull request merges to `main`, and the `Deploy` workflow runs. It is five
   lines: the route itself lives once in
   [tidemann/deploy-workflows](https://github.com/tidemann/deploy-workflows),
   pinned at `@v1`, and every st44 site calls that same copy.
3. That workflow builds the image and pushes **one** immutable tag,
   `ghcr.io/tidemann/food-st44:<full-commit-sha>`, to the GitHub Container
   Registry. There is no `latest` and no tarball: the SHA tag is the only
   release identity. The package is private and stays private.
4. It then connects to the server over SSH, copies `infra/docker-compose.yml`
   there with an `.env` naming the image, and runs
   `docker compose pull && up -d --force-recreate`. **The registry pull happens
   on the server, as the deploy user, whose docker config already holds the GHCR
   credential** — so no credential goes near CI. It runs on every push to `main`
   and on demand with `gh workflow run deploy.yml`.
5. The deploy is only green once `https://food.st44.no/healthz` returns 200 `ok`
   over valid TLS, not merely once the container starts.

The image that actually runs is named in the `.env` the deploy workflow writes
beside the compose file on the server — the compose file itself just says
`${IMAGE}`. Rolling back means pointing that `.env` at a previous SHA and
running compose up again; every deploy run prints the image it replaced.
`DEPLOY.md` has the exact commands.

The server side — the Docker runtime, the nginx vhost for `food.st44.no` and its
TLS certificate — is owned by Server Admin, not by this repository. `DEPLOY.md`
has the full contract, the prerequisites and the rollback procedure.

`main` is protected by the `protect-main` ruleset: changes must go through a
pull request, both CI checks (`Validate sources` and `Build image`) must pass,
and force-pushes and branch deletion are rejected. No review approval is
required, so a single maintainer can still merge their own pull request once
CI is green.

## Licence

MIT — see [LICENSE](LICENSE).
