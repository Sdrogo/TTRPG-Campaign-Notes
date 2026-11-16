#!/usr/bin/env bash
# Runs the Alembic migrations on this server's database (ticket 74). Run by
# .github/workflows/deploy-vps.yml (before a deploy whose PR has the
# `db-migration` label) and migrate-db.yml (the manual button), over SSH
# from /opt/exlibris:
#   bash migrate.sh [image tag]
# migrations.tgz, copied here by the workflow, holds the commit's
# backend/migrations/ and backend/alembic.ini: the image leaves them out. They
# run inside the backend image (the given tag, or the one deployed now) with
# this server's backend.env, so the database URL never leaves the server.
set -euo pipefail

cd "$(dirname "$0")"
tag="${1:-}"

# migrations.tgz belongs to this run only.
trap 'rm -f migrations.tgz' EXIT
if [ ! -f migrations.tgz ]; then
  echo "migrations.tgz is missing; nothing to run" >&2
  exit 1
fi
rm -rf migrations-src
mkdir migrations-src
tar -xzf migrations.tgz -C migrations-src

# With no tag, compose uses BACKEND_TAG from .env: the image deployed now.
if [ -n "$tag" ]; then export BACKEND_TAG="$tag"; fi

alembic() {
  docker compose run --rm --no-deps -T \
    -v "$PWD/migrations-src/migrations:/app/migrations:ro" \
    -v "$PWD/migrations-src/alembic.ini:/app/alembic.ini:ro" \
    backend alembic "$@"
}

echo "== database before"
alembic current
echo "== pending"
alembic history -r current:head
echo "== upgrade"
alembic upgrade head
echo "== database after"
alembic current
