# food-st44

The website for **https://food.st44.no**.

Right now this is a placeholder: one static page that says the site is coming.
The product stack has not been decided yet, so the pipeline is deliberately
stack-agnostic — it builds whatever is in `site/` into an nginx image. When the
real site arrives, replace `site/` (or add a build step that writes into it) and
nothing else has to change.

## Layout

| Path                       | What it is                                      |
| -------------------------- | ----------------------------------------------- |
| `site/`                    | The static files that get served.                |
| `nginx.conf`               | Server config, including the `/healthz` endpoint.|
| `Dockerfile`               | Packages `site/` into an nginx image.            |
| `.github/workflows/ci.yml` | Validate → build → smoke test → push to GHCR.    |
| `.github/workflows/deploy.yml` | Ships the compose file to the server over SSH and runs it. |
| `infra/docker-compose.yml` | The deploy unit: which image tag runs, on which network. |
| `DEPLOY.md`                | How the deploy works, its prerequisites, and how to roll back. |

## Run it locally

You only need Docker.

```bash
docker build -t food-st44:dev .
docker run --rm -p 8080:80 food-st44:dev
```

Then open http://localhost:8080 — and http://localhost:8080/healthz should
return `ok`.

If you only want to look at the page without Docker, open `site/index.html` in a
browser, or serve the folder:

```bash
python3 -m http.server 8080 --directory site
```

Note that `/healthz` only exists in the Docker version; it comes from
`nginx.conf`.

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
