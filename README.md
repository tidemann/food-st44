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
   image, and runs it to confirm `/healthz` answers. Nothing is published.
2. The pull request merges to `main`. CI builds the image again, smoke tests it,
   and pushes **that same build** to the GitHub Container Registry as:
   - `ghcr.io/tidemann/food-st44:<full-commit-sha>` — the immutable tag, this is
     what a deploy should reference.
   - `ghcr.io/tidemann/food-st44:latest` — a convenience pointer, never the
     source of truth for a deploy.

   The same build is also uploaded as a `docker save` tarball on the workflow
   run, but that download still needs a GitHub login.
3. The `Deploy` workflow then connects to the server over SSH, copies
   `infra/docker-compose.yml` there, and runs `docker compose pull && up -d`.
   **The registry pull happens on the server, as the deploy user, whose docker
   config already holds the GHCR credential** — so the package stays private and
   no credential goes near CI. It runs on every push to `main` and on demand
   with `gh workflow run deploy.yml`.
4. The deploy is only green once `https://food.st44.no/healthz` returns 200 `ok`
   over valid TLS, not merely once the container starts.

The image tag that actually runs is the one pinned in
`infra/docker-compose.yml`. To deploy a different build — or to roll back —
change that tag and merge. Every commit that reached `main` has an immutable SHA
tag in GHCR, and every deploy run prints the image it replaced.

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
