# Deploy handoff — food.st44.no

Everything needed to run this container. Nothing here requires asking the
repository owner.

## Artifact

| Fact             | Value                                                           |
| ---------------- | --------------------------------------------------------------- |
| Registry         | `ghcr.io` (GitHub Container Registry)                            |
| Image            | `ghcr.io/tidemann/food-st44`                                     |
| Tag to deploy    | the **full commit SHA** of the `main` commit you are shipping    |
| Convenience tag  | `latest` — points at the newest `main` build, do not deploy by it |
| Architecture     | `linux/amd64`                                                    |
| Base image       | `nginx:1.29-alpine`, pinned by digest                            |
| Approx. size     | ~50 MB                                                           |

The image is **private**, because the repository is private. Pulling needs a
GitHub token with `read:packages` for the `tidemann` account:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u tidemann --password-stdin
docker pull ghcr.io/tidemann/food-st44:<commit-sha>
```

Do not put a token in this file or in any issue comment. If you need a
pull-only credential, ask Oskar — it goes through Paperclip secrets.

### Fallback if you cannot pull from GHCR

GHCR needs a token with `read:packages`, which a plain repository token does
**not** have. If `docker pull` is denied, take the tarball instead — every
`main` build uploads one, and plain repository access is enough to download it:

```bash
gh run download --repo tidemann/food-st44 --name "image-<commit-sha>" --dir .
docker load < "food-st44-<commit-sha>.tar.gz"
```

That loads the identical image, same digest, same tags. Tarballs are kept for
14 days, so use GHCR for anything older.

## Runtime

| Fact                  | Value                                                  |
| --------------------- | ------------------------------------------------------ |
| Container port        | **80** (HTTP, plain — TLS terminates at the host nginx) |
| Suggested host port   | `127.0.0.1:8081` (bind to loopback, not `0.0.0.0`)      |
| Environment variables | **none** — the image needs no configuration             |
| Volumes               | **none** — the container is stateless, nothing persists |
| Secrets               | none at runtime                                         |
| Runs as               | nginx default (root master, `nginx` workers)            |
| Restart policy        | `unless-stopped`                                        |

Example:

```bash
docker run -d \
  --name food-st44 \
  --restart unless-stopped \
  -p 127.0.0.1:8081:80 \
  ghcr.io/tidemann/food-st44:<commit-sha>
```

## Health check

| Fact           | Value                                          |
| -------------- | ---------------------------------------------- |
| Path           | `/healthz`                                     |
| Method         | `GET`                                          |
| Expected       | HTTP `200`, body `ok`                          |
| In-container   | `http://127.0.0.1/healthz`                     |
| From the host  | `http://127.0.0.1:8081/healthz`                |
| Public         | `https://food.st44.no/healthz`                 |

The image also declares a Docker `HEALTHCHECK` on the same path, so
`docker ps` shows `healthy` once it is up (within ~10 s).

**The deploy is finished when `https://food.st44.no/healthz` returns `ok`** —
not when the container starts.

## Hostname and TLS

| Fact     | Value                                                    |
| -------- | -------------------------------------------------------- |
| Hostname | `food.st44.no`                                            |
| Scheme   | HTTPS, with HTTP redirecting to HTTPS                     |
| TLS      | Let's Encrypt, same approach as the other ST44 hosts      |
| DNS      | `food.st44.no` must resolve to the server before issuing a certificate |

The host nginx should reverse-proxy `food.st44.no` to the container's host port
(`127.0.0.1:8081` in the example above) and pass through the usual
`Host` / `X-Forwarded-For` / `X-Forwarded-Proto` headers. There is no
websocket, no upload, and no long-lived request — default proxy settings are
fine.

## Rollback

Every commit on `main` produces an image tagged with its full commit SHA, and
those tags are never overwritten. To roll back, run the previous SHA tag:

```bash
docker rm -f food-st44
docker run -d --name food-st44 --restart unless-stopped \
  -p 127.0.0.1:8081:80 ghcr.io/tidemann/food-st44:<previous-commit-sha>
```

List what is available with (needs a token with `read:packages`):

```bash
gh api /user/packages/container/food-st44/versions --jq '.[].metadata.container.tags'
```

Or just read the commit log — `git log --oneline main` — every entry has a
matching image tag.

## Who owns what

- **Oskar (GitHub & CI/CD)** — the repository, the image, the tags, the
  pipeline. Anything wrong with the artifact is his.
- **Server Admin** — the Docker runtime on the server, the nginx vhost, DNS and
  TLS. Anything wrong with how it is served is theirs.
