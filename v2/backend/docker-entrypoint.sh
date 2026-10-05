#!/bin/sh
# Container start: secret key, database schema, the one-time copy of the v1 recipes, then the
# command (gunicorn). Any step that fails stops the container, so a deploy fails its health gate
# instead of serving an empty or half-migrated site.
set -eu

# DJANGO_SECRET_KEY_FILE (set by infra/docker-compose.yml): a key kept on the data volume and
# created on first start, so no secret has to be provisioned on the host. An explicit
# DJANGO_SECRET_KEY wins; with neither, Django refuses to start, as before.
if [ -z "${DJANGO_SECRET_KEY:-}" ] && [ -n "${DJANGO_SECRET_KEY_FILE:-}" ]; then
  if [ ! -s "$DJANGO_SECRET_KEY_FILE" ]; then
    (umask 077 && head -c 48 /dev/urandom | base64 | tr -d '\n' > "$DJANGO_SECRET_KEY_FILE")
  fi
  DJANGO_SECRET_KEY="$(cat "$DJANGO_SECRET_KEY_FILE")"
  export DJANGO_SECRET_KEY
fi

python manage.py migrate --noinput

# V1_DB_PATH (set by infra/docker-compose.yml): the v1 site's SQLite file, mounted read-only.
# Imported once, then never again: a recipe deleted on v2 must not come back from the v1 file on
# the next restart. The marker sits next to the v2 database, on the same volume.
if [ -n "${V1_DB_PATH:-}" ]; then
  marker="$(dirname "$DJANGO_DB_PATH")/v1-imported"
  if [ -e "$marker" ]; then
    echo "v1 import: already done ($(cat "$marker")), skipping"
  else
    python manage.py import_v1_recipes "$V1_DB_PATH"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) from $V1_DB_PATH" > "$marker"
  fi
fi

exec "$@"
