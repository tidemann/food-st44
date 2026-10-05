# Deploy — food.st44.no

There is exactly one supported way to deploy this site: **CI sends the compose
file to the server over SSH on stdin, where the site's own `deploy.sh` installs
it, pulls, recreates and gates on health.** The GHCR package is private and stays
private. Nothing here needs a public release asset, and no registry credential
ever travels through GitHub Actions.

Proven end to end on the shared route by
[run 36973507313](https://github.com/tidemann/food-st44/actions/runs/36973507313):
built and pushed from the calling repo, compose file accepted on the host,
private pull, container healthy, `https://food.st44.no/healthz` returning 200
`ok` over valid TLS.

## Release identity

- Image: `ghcr.io/tidemann/food-st44`
- Tag: the full commit SHA of the `main` commit being deployed. Nothing else is
  published — no `latest`, no tarball.
- Platform: `linux/amd64`

Do not read the deployed version from this file — it moves on every merge. The
live value is in the deploy run's step summary (**Image**, **Digest** and
**Previous image**), and on the server in the `previous-image:` line `deploy.sh`
prints and in `/srv/apps/food-st44/infra/docker-compose.yml`.

At the time of writing that is commit
[`31177df`](https://github.com/tidemann/food-st44/commit/31177df3c9b1449513d786a395f21481d84c3547).

The deployed tag is rendered into the compose file by the deploy workflow before
it is sent; `infra/docker-compose.yml` in the repo says `${IMAGE}`. Only the
commit-SHA tag is published — there is no `latest`, so there is no pointer to
mistake for a release identity.

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
3. renders `infra/docker-compose.yml`, resolving `${IMAGE}` to the image just
   built, so the immutable per-commit tag travels inside the file;
4. makes **one ssh call** to `/srv/apps/food-st44/deploy.sh` — the forced
   command on this repo's deploy key — with the rendered compose file on stdin.
   That script installs the file (keeping the previous one as
   `docker-compose.yml.prev`), pulls, recreates, prints the container state and
   runs the internal health gate, exiting non-zero if the container does not
   answer. Its output names the previous image, which is the rollback anchor;
5. gates on `https://food.st44.no/healthz` = 200 `ok` over valid TLS. A green
   container is not a finished deploy.

A deploy is finished when step 5 passes, not when the container starts.

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

### Scope of `DEPLOY_KEY`

The shared route and the host's `deploy.sh` are in place (see the forced-command
rollout on [ST-47](/ST/issues/ST-47)). Once the key is re-minted with
`agent-deploy-key`, it is installed as
`restrict,command="/srv/apps/food-st44/deploy.sh"`: `restrict` turns off the
pty, port/agent/X11 forwarding and `~/.ssh/rc`, and the forced command means
sshd runs that one script and discards whatever command line CI sent. A leaked
`DEPLOY_KEY` can then redeploy food-st44 and nothing else — no arbitrary
commands as the deploy user, and no touching another site's directory. Until the
key is re-minted, treat `DEPLOY_KEY` as deploy-user access and rotate it
immediately if it is exposed.

## Runtime contract

| Fact | Value |
| --- | --- |
| Container name | `food-st44` |
| Compose project | `food-st44` (pinned; the directory name `infra` would collide with st44-home) |
| Compose file on the server | `/srv/apps/food-st44/infra/docker-compose.yml` |
| Container port | `80` (HTTP) |
| Docker network | `st44_default`, shared with `nginx-proxy` |
| Published host ports | None, by design |
| Image | v2 (Angular + Django), built from `./Dockerfile`, which copies `v2/` |
| Environment variables | Set in the compose file: `DJANGO_ALLOWED_HOSTS`, `DJANGO_DB_PATH`, `DJANGO_SECRET_KEY_FILE`, `V1_DB_PATH` |
| Volumes | `food-st44-v2-data` at `/data` (v2 SQLite database, secret key, `v1-imported` marker); `food-st44-data` at `/v1`, **read-only** (the v1 site's `recipes.db`, kept for rollback) |
| Runtime secrets | None provisioned. The Django secret key is created on first start in `/data/secret_key` |
| Start-up | `docker-entrypoint.sh`: create the secret key if missing, `migrate`, copy the v1 recipes once (`import_v1_recipes`, same ids), then gunicorn |
| Restart policy | `unless-stopped` |
| Hostname | `food.st44.no` |
| nginx upstream | `http://food-st44:80` |
| Health check | `GET /healthz` → 200, body `ok`. The host gate runs `docker exec food-st44 wget -qO- http://food-st44:80/healthz`, so the image must ship `wget` |

Do not hand-edit the compose file on the server. Every deploy overwrites it with
the copy from this repository; edit `infra/docker-compose.yml` and merge.

## Changing what is deployed

Merge to `main`. The deploy workflow builds that commit, pushes it as
`ghcr.io/tidemann/food-st44:<commit-sha>` and deploys that exact tag — there is
nothing to edit. `infra/docker-compose.yml` says `${IMAGE}`; the workflow renders
it to the concrete image before sending it on stdin to `deploy.sh`. CI parses the
compose file with real `docker compose config` on every pull request, so a typo
fails before it reaches the server.

## Rollback

Every deploy names the artifact it is replacing. The host's `deploy.sh` prints a
`previous-image:` line in its "Record what is running now" step, and the run
summary echoes it, for example:

```
previous-image: food-st44=ghcr.io/tidemann/food-st44:<previous-sha>
```

There is **no** rollback by `image-tag` from CI. `deploy.yml` declares no
`workflow_dispatch` inputs, and the shared workflow's `image-tag` input does not
mean "deploy this old tag": it *builds the checked-out commit* and pushes it
under that tag. Pointed at a previous SHA, it would overwrite the good image in
GHCR with a build of the current code.

The two rollbacks that work:

1. **Revert in git (CI).** Revert the bad merge on `main` (a PR, merged by
   Maria). The deploy workflow builds the reverted source and deploys it. This
   is the permanent fix and needs nothing on the host.
2. **Previous compose file (host, fastest).** `deploy.sh` keeps the compose file
   it replaced as `docker-compose.yml.prev`, with the previous image tag in it.
   Run as the deploy user on spzmf:

   ```bash
   cd /srv/apps/food-st44/infra
   cp docker-compose.yml docker-compose.yml.bad
   cp docker-compose.yml.prev docker-compose.yml
   docker compose -p food-st44 up -d --force-recreate
   curl -fsS https://food.st44.no/healthz
   ```

   The next push to `main` re-deploys `main`, so follow it with the revert
   (1).

### Rolling back the v2 switch-over

The switch from v1 to v2 left the v1 data where it was: the volume
`food-st44_food-st44-data`, file `recipes.db`, which v2 only mounts read-only.
Both rollbacks put the v1 image back on that volume, read-write, with the data
exactly as it was at the switch. Recipes added or edited on v2 after the switch
are only in `food-st44_food-st44-v2-data`; they are not copied back.

For the host rollback, do not use `docker-compose.yml.prev`: it is the v1 file
only until the next deploy to `main`, and after that it is a v2 file. Use
`docker-compose.v1.yml`, the copy of the v1 compose file saved before the
switch. Never just change the image in the v2 compose file: v1 would then get
the v2 volume at `/data`, create an empty `recipes.db` there and still pass
`/healthz`.
The full runbook, with the commands Bob runs before and after, is the `cutover`
document on [ST-492](https://paperclip.st44.no/ST/issues/ST-492).

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
