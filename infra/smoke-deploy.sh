#!/usr/bin/env bash
# Runs infra/docker-compose.yml the way the host does, against a v1 volume as the live v1 site
# leaves it, and checks the switch-over: the v1 recipes arrive once with the same ids, /healthz
# answers `ok`, and the v1 file is byte-for-byte unchanged afterwards.
#
#   infra/smoke-deploy.sh <image>
#
# CI runs it on every pull request (ci.yml, build job). It creates and then removes the
# compose project `food-st44-smoke`, its volumes and the st44_default network if it made it,
# so it must not be run on the server.
set -euo pipefail

IMAGE="${1:?usage: infra/smoke-deploy.sh <image>}"
export IMAGE
PROJECT=food-st44-smoke
V1_VOLUME="${PROJECT}_food-st44-data"
compose() { docker compose -p "$PROJECT" -f "$(dirname "$0")/docker-compose.yml" "$@"; }
work="$(mktemp -d)"
made_network=no

cleanup() {
  rc=$?
  [ "$rc" -eq 0 ] || compose logs || true
  compose down -v >/dev/null 2>&1 || true
  [ "$made_network" = no ] || docker network rm st44_default >/dev/null 2>&1 || true
  rm -rf "$work"
  exit "$rc"
}
trap cleanup EXIT

if ! docker network inspect st44_default >/dev/null 2>&1; then
  docker network create st44_default >/dev/null
  made_network=yes
fi

# The v1 database as src/db.js creates it: ids 1 and 3 present, 4 deleted, so the AUTOINCREMENT
# counter (4) is above the highest live id.
sqlite3 "$work/recipes.db" <<'SQL'
CREATE TABLE recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  ingredients TEXT NOT NULL,
  instructions TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO recipes (id, title, ingredients, instructions, created_at) VALUES
  (1, 'Fårikål', 'fårekjøtt', 'Kok i tre timer.', '2026-01-05 17:30:00'),
  (3, 'Sveler', 'mel', '', '2026-02-01 08:00:00'),
  (4, 'Slettes', 'x', '', '2026-03-01 08:00:00');
DELETE FROM recipes WHERE id = 4;
SQL

# Volumes and container, not started; then seed the v1 volume as root, as the v1 image (which
# runs as root) leaves it.
compose create
docker run --rm --user root --entrypoint cp -v "$work:/seed:ro" -v "$V1_VOLUME:/data" \
  "$IMAGE" /seed/recipes.db /data/recipes.db
v1_sum() {
  docker run --rm --user root --entrypoint sha256sum -v "$V1_VOLUME:/data:ro" "$IMAGE" \
    /data/recipes.db | cut -d' ' -f1
}
before="$(v1_sum)"

compose up -d
ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' food-st44)"
# nginx-proxy and the host's health gate reach the container by service name.
get() { curl -sS -H 'Host: food-st44' "$@"; }
wait_healthy() {
  for i in $(seq 1 60); do
    if [ "$(get -o /dev/null -w '%{http_code}' "http://$ip/healthz" 2>/dev/null)" = 200 ]; then
      return 0
    fi
    [ "$i" != 60 ] || { echo '::error::container never answered /healthz'; return 1; }
    sleep 1
  done
}
wait_healthy

test "$(get "http://$ip/healthz")" = ok
get -H 'Host: food.st44.no' -fo /dev/null "http://$ip/"
get "http://$ip/api/recipes" | jq -e 'map(.id) | sort == [1, 3]' >/dev/null
test "$(get -o /dev/null -w '%{http_code}' "http://$ip/recipes/3")" = 200
test "$(get -o /dev/null -w '%{http_code}' "http://$ip/recipes/4")" = 404
# A new recipe must not reuse v1's deleted id 4.
new_id="$(get -f -X POST -H 'Content-Type: application/json' \
  -d '{"title":"Ny","ingredients":"x","instructions":""}' "http://$ip/api/recipes" | jq -e .id)"
test "$new_id" = 5

# The import runs once: a recipe deleted on v2 stays deleted across a restart.
test "$(get -o /dev/null -w '%{http_code}' -X DELETE "http://$ip/api/recipes/1")" = 204
compose restart
ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' food-st44)"
wait_healthy
get "http://$ip/api/recipes" | jq -e 'map(.id) | sort == [3, 5]' >/dev/null
compose logs food-st44 | grep -q 'v1 import: already done'

# The v1 file is untouched, so rolling back to v1 finds its data as it was.
compose stop
test "$(v1_sum)" = "$before"

echo "deploy smoke test passed: v1 recipes imported once with their ids, v1 file unchanged"
