# Deploy handoff — food.st44.no

## Release identity

- Image: `ghcr.io/tidemann/food-st44`
- Selected SHA tag: `d50023c5c17764c1ea4c36e3ba8112bb3bd2ff4e`
- Registry manifest digest: `sha256:769fc817db5fa6a8c7c9db2fe3e15b8d2300f482bc79bbdb4bb0aec90efd23bc`
- Config digest (image ID after `docker load`): `sha256:ddd54b02009e855ae006c0b9c7ad13d5561917cdad2b50e860df05345884ce7f`
- Platform: `linux/amd64`
- Build proof: https://github.com/tidemann/food-st44/actions/runs/36539383656

Keep this release identity. Do not rebuild or substitute `latest`.

## How to get the image (no credentials)

The source repository is public, but package visibility is separate and the
GHCR package is still private: anonymous `docker pull` of this digest returns
HTTP 403. Nobody on this team has package administration, so the image is
distributed as a **public GitHub release asset** instead. Release assets on a
public repository download with no token, so spzmf never needs registry
credentials.

- Release: https://github.com/tidemann/food-st44/releases/tag/image-d50023c5
- Export proof: https://github.com/tidemann/food-st44/actions/runs/36563047075

Pull proof, off GitHub infrastructure (2026-09-29): all six assets downloaded
with `curl -H 'Authorization:'` from a host with no GitHub credentials;
`sha256sum -c SHA256SUMS` passed, `sha256sum manifest.json` equalled the
registry digest `769fc817…`, and the archive's own `manifest.json` names config
`ddd54b02…` with repo tag
`ghcr.io/tidemann/food-st44:d50023c5c17764c1ea4c36e3ba8112bb3bd2ff4e`.

Nothing was rebuilt. `.github/workflows/publish-image-archive.yml` copies the
existing digest out of GHCR with `skopeo` and attaches it to the release.

```bash
BASE=food-st44-d50023c5c17764c1ea4c36e3ba8112bb3bd2ff4e
URL=https://github.com/tidemann/food-st44/releases/download/image-d50023c5

curl -fsSLO "$URL/$BASE.docker.tar.gz"
curl -fsSLO "$URL/SHA256SUMS"
sha256sum -c --ignore-missing SHA256SUMS

gunzip -c "$BASE.docker.tar.gz" | docker load
```

Verify identity after loading — the image ID must equal the config digest:

```bash
docker image inspect --format '{{.Id}}' \
  ghcr.io/tidemann/food-st44:d50023c5c17764c1ea4c36e3ba8112bb3bd2ff4e
# sha256:ddd54b02009e855ae006c0b9c7ad13d5561917cdad2b50e860df05345884ce7f
```

`docker load` does not restore a registry RepoDigest, so check the image ID, not
`RepoDigests`. The registry digest is still verifiable from the release: the
published `manifest.json` is the original manifest bytes, so
`sha256sum manifest.json` equals `769fc817…`. `$BASE.oci.tar.gz` preserves those
bytes if the image is ever re-pushed to a registry.

Do not pass registry credentials to Bob. A GitHub Actions artifact download
requires GitHub authentication and is not an anonymous server handoff; a public
release asset is.

If package administration is restored later, making the GHCR package public is
still the preferred route, and `docker pull …@sha256:769fc817…` then works
directly. The archive stays valid either way — it is the same image.

## Runtime contract

| Fact | Value |
| --- | --- |
| Container name | `food-st44` |
| Container port | `80` (HTTP) |
| Docker network | `st44_default`, shared with `nginx-proxy` |
| Published host ports | None |
| Environment variables | None |
| Volumes | None; stateless |
| Runtime secrets | None |
| Restart policy | `unless-stopped` |
| Hostname | `food.st44.no` |
| nginx upstream | `http://food-st44:80` |

Server Admin runs these commands through the server's permitted tooling after
reading `/srv/nginx/AGENTS.md`. These are the Docker semantics, not permission
to bypass server wrappers:

```bash
# Image comes from the release archive above, not from a registry pull.
docker run -d --name food-st44 --restart unless-stopped \
  --network st44_default \
  ghcr.io/tidemann/food-st44:d50023c5c17764c1ea4c36e3ba8112bb3bd2ff4e
```

The tag is the one baked into the archive; it resolves to the locally loaded
image, so this does not contact the registry. Confirm the image ID matches the
config digest before running it.

There is deliberately no `-p`. nginx-proxy terminates TLS and proxies to
`http://food-st44:80`, passing Host, X-Forwarded-For and X-Forwarded-Proto.
Server Admin owns Docker runtime, nginx configuration and TLS; Maria owns DNS.

## Verification and rollback

Bob records the checksum result and the loaded image ID before running the
container. Verify `http://food-st44:80/healthz` from the proxy network:
HTTP 200 with body `ok`. The image's own health check uses
`http://127.0.0.1/healthz` inside the food-st44 container; that local check is valid.
Deployment finishes when `https://food.st44.no/healthz` returns HTTP 200 and `ok`
over valid TLS, with HTTP redirecting to HTTPS.

Before replacing an existing service, record its exact image digest and run
configuration. Roll back by recreating it with that digest on `st44_default`
and checking health again. This is the first deployment: no previous good
server artifact is established. Earlier build tags `736275fb6bcd58a9d2a773dcb7c61807a17fd44e`
and `bb40aab95053546854a4329d8179c59c01001d0d` are candidates only, not verified
server rollback artifacts. If first deployment fails, Server Admin removes the
new service/vhost using permitted tooling and restores the prior server state.

## Lessons from the failed handoff

- Images for spzmf must be reachable by the server without credentials. Prove the
  exact SHA/digest can be fetched anonymously before handing off; a green
  authenticated CI push is insufficient.
- Repository visibility is not package visibility. A public repo with a private
  GHCR package still fails anonymous pull, and the failure only shows up at
  deploy time.
- When you cannot change access, change the distribution channel. A public
  release asset carrying the already-built image beats waiting on a permission
  nobody on the team holds. Do not rebuild to work around access — copy the
  existing digest.
- Never use 127.0.0.1 upstreams from nginx-proxy to another container. Container
  loopback belongs to that container; use `food-st44:80` on `st44_default`.
- A Docker archive preserves image content and tags, but do not assume it
  preserves a registry RepoDigest after loading; verify the image ID against the
  config digest instead, and publish the raw manifest so the registry digest
  stays checkable.
- A delivery path is not proven until it has been exercised unauthenticated. The
  publish workflow re-downloads its own asset with no credentials and fails if
  that does not work.
- Return agent-output failures to the responsible agent or Maria, never the user.
