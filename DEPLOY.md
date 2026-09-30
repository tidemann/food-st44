# Deploy — food.st44.no

There is exactly one supported way to deploy this site: **CI connects to the
server over SSH and runs `docker compose` there.** The GHCR package is private
and stays private. Nothing here needs a public release asset, and no registry
credential ever travels through GitHub Actions.

Proven end to end on the shared route by
[run 36730946719](https://github.com/tidemann/food-st44/actions/runs/36730946719):
built and pushed from the calling repo, private pull on the host, container
healthy, `https://food.st44.no/healthz` returning 200 `ok` over valid TLS.

## Release identity

- Image: `ghcr.io/tidemann/food-st44`
- Tag: the full commit SHA of the `main` commit being deployed. Nothing else is
  published — no `latest`, no tarball.
- Platform: `linux/amd64`

Do not read the deployed version from this file — it moves on every merge. The
live value is in the deploy run's step summary (**Image**, **Digest** and
**Previous image**), and on the server in `/srv/apps/food-st44/infra/.env`.

At the time of writing that is commit
[`9d6f67f`](https://github.com/tidemann/food-st44/commit/9d6f67f91c6a81782f9c88d35115f9d409c6d082),
digest `sha256:4fa89bdf96f485c340d7423a9414cd11df9c72f64d449ac8567b92777e505cd7`,
which replaced `d50023c5c17764c1ea4c36e3ba8112bb3bd2ff4e`.

The deployed tag is named in the `.env` the deploy workflow writes on the
server; `infra/docker-compose.yml` says `${IMAGE}`. Only the commit-SHA tag is
published — there is no `latest`, so there is no pointer to mistake for a
release identity.

## How a deploy runs

`.github/workflows/deploy.yml` runs on `workflow_dispatch` and on push to
`main`. It holds no deploy logic of its own — it calls the shared workflow in
[tidemann/deploy-workflows](https://github.com/tidemann/deploy-workflows),
pinned at `@v1`:

```yaml
jobs:
  deploy:
    uses: tidemann/deploy-workflows/.github/workflows/build-and-deploy.yml@v1
    with:
      app-name: food-st44
      site-host: food.st44.no
    secrets: inherit
```

Every st44 site calls that same copy, so a fix to the route lands everywhere at
once. `@v1` is a tag, not a branch: moving it is a deliberate act. In order, it:

1. builds the image and pushes it to GHCR as
   `ghcr.io/tidemann/food-st44:<commit-sha>`;
2. installs `DEPLOY_KEY`, `ssh-keyscan`s `SERVER_HOST` into `known_hosts` with
   `StrictHostKeyChecking yes`, and writes one ssh alias so the host and user
   are named once;
3. records the image currently running as `food-st44` — the rollback anchor —
   before touching anything;
4. `mkdir -p`s `/srv/apps/food-st44/infra` and checks it is writable;
5. `scp`s `infra/docker-compose.yml` there, plus an `.env` naming the image just
   built (the server has no git clone);
6. runs `docker compose pull && docker compose up -d --force-recreate`. **The
   pull happens on the host, as the deploy user, whose docker config holds the
   GHCR credential.** That is the whole point of this route;
7. gates on `http://food-st44:80/healthz` = `ok` from inside the shared network,
   then on `https://food.st44.no/healthz` = 200 `ok` over valid TLS.

A deploy is finished when step 7 passes, not when the container starts.

`.github/workflows/ci.yml` builds and smoke-tests the image on every pull
request but never pushes it. The deploy workflow is the only publisher.

To deploy manually:

```bash
gh workflow run deploy.yml --repo tidemann/food-st44 --ref main
```

## Prerequisites (all already in place)

| Prerequisite | Who owns it | State |
| --- | --- | --- |
| Repo secrets `DEPLOY_KEY`, `SERVER_HOST`, `SERVER_USER` | minted by `sudo agent-deploy-key tidemann/food-st44` on the server | set |
| `/srv/apps/food-st44`, owned by the deploy user | Server Admin (`sudo agent-docker mkapp food-st44 --deploy`) | created |
| Deploy user logged in to `ghcr.io` | Server Admin | done; private pull works |
| Docker network `st44_default` | the existing stack | exists |
| nginx vhost + TLS for `food.st44.no` → `http://food-st44:80` | Server Admin (`sudo agent-nginx install-site`) | installed |

The deploy user's name is deliberately not written down here: this repository is
public, and the name lives in the `SERVER_USER` secret.

To rotate the deploy key, re-run `sudo agent-deploy-key tidemann/food-st44` on
the server. It replaces the `authorized_keys` line and overwrites the three
repo secrets in one step.

### Scope of `DEPLOY_KEY` — read this before treating it as harmless

`agent-deploy-key` installs the key as a plain `restrict` line. `restrict` turns
off the pty, port/agent/X11 forwarding and `~/.ssh/rc`; **it does not pin a
command.** A leaked `DEPLOY_KEY` can therefore run anything the deploy user can
run, not just this deploy. Narrowing it to a forced command needs a host-side
deploy script that does not exist yet. Until it does, treat `DEPLOY_KEY` as
deploy-user access and rotate it immediately if it is exposed.

## Runtime contract

| Fact | Value |
| --- | --- |
| Container name | `food-st44` |
| Compose project | `food-st44` (pinned; the directory name `infra` would collide with st44-home) |
| Compose file on the server | `/srv/apps/food-st44/infra/docker-compose.yml` |
| Container port | `80` (HTTP) |
| Docker network | `st44_default`, shared with `nginx-proxy` |
| Published host ports | None, by design |
| Environment variables | None |
| Volumes | None; stateless |
| Runtime secrets | None |
| Restart policy | `unless-stopped` |
| Hostname | `food.st44.no` |
| nginx upstream | `http://food-st44:80` |
| Health check | `GET /healthz` → 200, body `ok` |

Do not hand-edit the compose file on the server. Every deploy overwrites it with
the copy from this repository; edit `infra/docker-compose.yml` and merge.

## Changing what is deployed

Merge to `main`. The deploy workflow builds that commit, pushes it as
`ghcr.io/tidemann/food-st44:<commit-sha>` and deploys that exact tag — there is
nothing to edit. `infra/docker-compose.yml` says `${IMAGE}`; the workflow writes
`IMAGE=<image>` to a `.env` beside it on the server. CI parses the compose file
with real `docker compose config` on every pull request, so a typo fails before
it reaches the server.

## Rollback

Every deploy names the artifact it is replacing. The **Record the currently
deployed image** step and the run summary both print it, for example:

```
ghcr.io/tidemann/food-st44:d50023c5c17764c1ea4c36e3ba8112bb3bd2ff4e sha256:ddd54b02…
```

Rolling back means pointing the server's `.env` at that tag. On the server, as
the deploy user:

```bash
cd /srv/apps/food-st44/infra
printf 'IMAGE=ghcr.io/tidemann/food-st44:<previous-sha>\n' > .env
docker compose pull && docker compose up -d --force-recreate
```

Every commit that reached `main` has an immutable SHA tag in GHCR, so any of
them is a valid target.

Note that the next push to `main` re-deploys that commit and overwrites `.env`.
A rollback is therefore a stop-gap: follow it by reverting the bad commit in
git, which makes the revert the newest build and the rollback permanent.

## Lessons this route was built from

- Repository visibility is not package visibility. A public repo with a private
  GHCR package still fails an anonymous pull, and the failure only shows up at
  deploy time. Pull on the host, where the credential already is.
- Never send a registry credential to CI when the host already has one.
- Never use a `127.0.0.1` upstream from nginx-proxy to another container.
  Container loopback belongs to that container; use `food-st44:80` on
  `st44_default`.
- Pin the compose project name. Compose names a project after its directory, and
  more than one stack on this host deploys from a directory called `infra`; a
  `compose down` in either could have taken out the other's containers.
- A workflow that has never run is not done, and a green container is not a
  finished deploy. Gate on the public URL.
- Name the previous good artifact before replacing it.
- Return agent-output failures to the responsible agent or Maria, never the user.
