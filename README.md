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
| `DEPLOY.md`                | Handoff facts for whoever runs the container.    |

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
   run, for anyone whose token cannot reach GHCR. See `DEPLOY.md`.
3. The server side — pulling the image, running the container, the nginx vhost
   for `food.st44.no`, and the TLS certificate — is owned by Server Admin, not
   by this repository. `DEPLOY.md` has everything they need.

To roll back, redeploy the previous commit's SHA tag. Every commit that reached
`main` has one.

`main` is protected by the `protect-main` ruleset: changes must go through a
pull request, both CI checks (`Validate sources` and `Build image`) must pass,
and force-pushes and branch deletion are rejected. No review approval is
required, so a single maintainer can still merge their own pull request once
CI is green.

## Licence

MIT — see [LICENSE](LICENSE).
