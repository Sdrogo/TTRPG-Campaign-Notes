#!/usr/bin/env bash
# Deploys one backend image on the VPS and waits until it is healthy.
# Run by .github/workflows/deploy-prod.yml over SSH from /opt/exlibris:
#   bash deploy.sh <image tag>
# By hand, to roll back to the previous image:
#   cd /opt/exlibris && bash deploy.sh "$(cat .backend_tag.previous)"
set -euo pipefail

tag="${1:?usage: deploy.sh <image tag>}"
cd "$(dirname "$0")"

# BACKEND_TAG lives in .env, so a plain `docker compose up -d` later (or a
# reboot) keeps running this image. Other lines (API_HOSTS) are kept.
set_tag() {
  sed -i '/^BACKEND_TAG=/d' .env
  if [ -n "$1" ]; then echo "BACKEND_TAG=$1" >> .env; fi
}
touch .env
previous="$(sed -n 's/^BACKEND_TAG=//p' .env)"

# Pulled before .env changes: a failed pull leaves everything as it was.
BACKEND_TAG="$tag" docker compose pull backend

# From here on, any failure (`up`, the Caddy reload, the health check) puts
# the last healthy image back, so neither a reboot nor the next deploy's
# .backend_tag.previous ends up pointing at the broken one.
# On a first deploy there is nothing to restore: the pin is just removed.
restore() {
  set_tag "$previous"
  if [ -n "$previous" ]; then
    echo "deploy of $tag failed; restoring $previous" >&2
    docker compose up -d backend || true
  fi
}
trap restore ERR
set_tag "$tag"

docker compose up -d --remove-orphans
# Picks up a changed Caddyfile; a no-op otherwise.
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile

# The backend starts its sweeps at startup (app/main.py), so wait for its
# healthcheck rather than for the container to exist.
status=starting
for _ in $(seq 1 40); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q backend)")"
  [ "$status" = healthy ] && break
  sleep 3
done
if [ "$status" != healthy ]; then
  echo "backend is $status after 2 minutes; last logs:" >&2
  docker compose logs --tail 100 backend >&2
  false
fi
trap - ERR

[ -n "$previous" ] && [ "$previous" != "$tag" ] && echo "$previous" > .backend_tag.previous
# Unused images built more than a week ago go. Every image stays in GHCR, so
# a rollback to one of them pulls it again.
docker image prune -af --filter "until=168h" >/dev/null
echo "deployed $tag"
