# Deploy handoff — food.st44.no

## Release identity and access gate

- Image: `ghcr.io/tidemann/food-st44`
- Selected SHA tag: `d50023c5c17764c1ea4c36e3ba8112bb3bd2ff4e`
- Registry manifest digest: `sha256:769fc817db5fa6a8c7c9db2fe3e15b8d2300f482bc79bbdb4bb0aec90efd23bc`
- Platform: `linux/amd64`
- Build proof: https://github.com/tidemann/food-st44/actions/runs/36539383656

Keep this release identity while repairing access. Do not rebuild or substitute
`latest`. The source repository is public, but package visibility is separate.
Anonymous GHCR access currently fails (HTTP 401 on 2026-09-29); deployment must
wait until anonymous pull of this exact digest succeeds on spzmf.

Oskar owns access repair; Maria owns escalation for missing package administration
permissions. The intended remedy is public visibility for the package at
https://github.com/users/tidemann/packages/container/food-st44/settings.
Do not pass registry credentials to Bob. A GitHub Actions artifact download
requires GitHub authentication and is not an anonymous server handoff.

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
docker pull ghcr.io/tidemann/food-st44@sha256:769fc817db5fa6a8c7c9db2fe3e15b8d2300f482bc79bbdb4bb0aec90efd23bc
docker run -d --name food-st44 --restart unless-stopped \
  --network st44_default \
  ghcr.io/tidemann/food-st44@sha256:769fc817db5fa6a8c7c9db2fe3e15b8d2300f482bc79bbdb4bb0aec90efd23bc
```

There is deliberately no `-p`. nginx-proxy terminates TLS and proxies to
`http://food-st44:80`, passing Host, X-Forwarded-For and X-Forwarded-Proto.
Server Admin owns Docker runtime, nginx configuration and TLS; Maria owns DNS.

## Verification and rollback

Bob records the anonymous server pull result and resolved digest before running
the container. Verify `http://food-st44:80/healthz` from the proxy network:
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

- Images for spzmf must be pullable by the server. Prove anonymous access to the
  exact SHA/digest before handing off; a green authenticated CI push is insufficient.
- Never use 127.0.0.1 upstreams from nginx-proxy to another container. Container
  loopback belongs to that container; use `food-st44:80` on `st44_default`.
- A Docker archive preserves image content and tags, but do not assume it
  preserves a registry RepoDigest after loading; verify identity explicitly.
- Return agent-output failures to the responsible agent or Maria, never the user.
