#!/usr/bin/env bash
# Moves this server's database from Supabase to Postgres on the server
# (ticket 73 step 5). Run once per server from /opt/exlibris, at a quiet
# hour, after a deploy that brought the `db` service:
#   bash db-setup.sh
# The API does not answer for a few minutes (step 3 to 5).
# With a dump file (from `bash backup.sh fetch <day>`), the data comes from
# that file instead of Supabase, and the database on this server is replaced
# with it: the restore of context/restore-runbook.md.
#   bash db-setup.sh restore-<day>.dump
#
# 1. Writes the superuser's password (postgres.env), turns on the `db`
#    profile with memory settings sized for this box, starts Postgres and
#    prepares an empty database: the app role `exlibris` (owner, not a
#    superuser), the roles `anon` and `authenticated` (NOLOGIN, no grants:
#    the deny policies name them) and `extensions.unaccent` (the search
#    configuration uses it).
# 2. Stops the backend.
# 3. Dumps the `public` schema from the database in backend.env (Supabase,
#    so its password never leaves this server) into supabase-<date>.dump,
#    and restores it as `exlibris`.
# 4. Compares the row count of every table on both sides and stops on any
#    difference.
# 5. Points DATABASE_URL at the new database (the old line stays, commented
#    out, for rollback), starts the backend and checks it reads the data.
# If any step fails, the backend is started again on Supabase, unchanged.
# Safe to re-run until it succeeds; afterwards it refuses without a dump
# file, so it can never overwrite this database with an older Supabase copy.
#
# Rollback after success (losing what was written since):
#   sudo sed -i -e '/^DATABASE_URL=/d' -e 's/^#SUPABASE_DATABASE_URL=/DATABASE_URL=/' backend.env
#   docker compose up -d --force-recreate backend
# The single-quoted commands below run in a container, which expands them.
# shellcheck disable=SC2016
set -Eeuo pipefail
cd "$(dirname "$0")"

image=postgres:17.6@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929

dump_file="${1:-}"
if [ -n "$dump_file" ] && [ ! -s "$dump_file" ]; then
  echo "no dump file at $dump_file" >&2
  exit 1
fi
current_url="$(sudo sed -n 's/^DATABASE_URL=//p' backend.env)"
on_db=false
[[ "$current_url" == *@db:5432/* ]] && on_db=true
if [ -z "$dump_file" ]; then
  [ -n "$current_url" ] || { echo "backend.env has no DATABASE_URL" >&2; exit 1; }
  if $on_db; then
    echo "the backend already uses the database on this server; nothing to do" >&2
    exit 1
  fi
fi

# Sets KEY=value in .env, replacing an earlier value.
set_env() {
  sed -i "/^$1=/d" .env
  echo "$1=$2" >> .env
}
psql_admin() { docker compose exec -T -e PGOPTIONS=--client-min-messages=warning db psql -U postgres -d exlibris -v ON_ERROR_STOP=1 -q "$@"; }

echo "== 1. Postgres"
if [ ! -f postgres.env ]; then
  (umask 077 && printf '%s\n' \
    "POSTGRES_PASSWORD=$(openssl rand -hex 24)" \
    "EXLIBRIS_PASSWORD=$(openssl rand -hex 24)" > postgres.env)
fi
app_password="$(sed -n 's/^EXLIBRIS_PASSWORD=//p' postgres.env)"
touch .env
profiles="$(sed -n 's/^COMPOSE_PROFILES=//p' .env)"
case ",$profiles," in
  *,db,*) ;;
  *) set_env COMPOSE_PROFILES "${profiles:+$profiles,}db" ;;
esac
# A quarter of the memory for Postgres' own cache, half as the planner's
# guess of what the system caches.
mem_mb=$(( $(awk '/^MemTotal:/ {print $2}' /proc/meminfo) / 1024 ))
set_env PG_SHARED_BUFFERS "$(( mem_mb / 4 ))MB"
set_env PG_EFFECTIVE_CACHE_SIZE "$(( mem_mb / 2 ))MB"
docker compose up -d db
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q db)")" = healthy ] && break
  sleep 2
done
psql_admin -c 'SELECT 1' >/dev/null || { echo "Postgres did not start; see: docker compose logs db" >&2; exit 1; }

psql_admin <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'exlibris') THEN
    CREATE ROLE exlibris LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END \$\$;
ALTER ROLE exlibris PASSWORD '$app_password';
ALTER DATABASE exlibris OWNER TO exlibris;
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO exlibris;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
SQL

echo "== 2. Backend stopped: the API is down until step 5"
restart_unchanged() {
  echo "failed: starting the backend again, on the database it had" >&2
  docker compose up -d backend >&2
}
trap restart_unchanged ERR
docker compose stop backend

echo "== 3. Copy"
target_url="postgresql://exlibris:$app_password@db:5432/exlibris"
network="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' \
  "$(docker compose ps -q db)")"
# libpq's form of the URL: no driver name, and asyncpg's ssl= is sslmode=.
source_url="${current_url/postgresql+asyncpg:/postgresql:}"
source_url="${source_url//ssl=/sslmode=}"
# The URLs go in as environment variables, never on a command line.
pg() {
  SOURCE_URL="$source_url" TARGET_URL="$target_url" \
    docker run --rm -i --network "$network" -e SOURCE_URL -e TARGET_URL "$image" "$@"
}
if [ -z "$dump_file" ]; then
  dump_file="supabase-$(date -u +%F).dump"
  (umask 077 && pg sh -c 'pg_dump -Fc --schema=public --no-owner --no-privileges --no-publications --no-subscriptions --no-security-labels -d "$SOURCE_URL"' > "$dump_file")
  from_supabase=true
else
  from_supabase=false
fi
# Replacing the live database: its current state is kept first.
if $on_db; then
  (umask 077 && docker compose exec -T db pg_dump -U postgres -Fc exlibris > "before-restore-$(date -u +%FT%H%M).dump")
  echo "the database as it was is in before-restore-*.dump"
fi
# An empty schema each time, so a failed earlier run leaves nothing behind.
# (pg_restore --schema=public restores what is in the schema, not the schema.)
psql_admin -c 'DROP SCHEMA IF EXISTS public CASCADE' -c 'CREATE SCHEMA public AUTHORIZATION exlibris'
# Only `public`: a nightly dump also holds `extensions`, made in step 1.
pg sh -c 'pg_restore --schema=public --no-owner --no-privileges --exit-on-error --single-transaction -d "$TARGET_URL"' < "$dump_file"
echo "restored from $dump_file ($(du -h "$dump_file" | cut -f1))"

echo "== 4. Row counts"
# One query that counts every table of `public`, built from the restored
# tables, sorted here (byte order): Supabase and this server sort names
# differently. From Supabase it runs on both sides (a table missing there fails
# here); from a file there is no other side, so it only prints the totals.
count_sql="SELECT string_agg(format('SELECT %L, count(*) FROM public.%I', tablename, tablename), ' UNION ALL ') || ' ORDER BY 1' FROM pg_tables WHERE schemaname = 'public'"
query="$(pg sh -c 'psql -At -d "$TARGET_URL" -c "$0"' "$count_sql")"
target_counts="$(pg sh -c 'psql -At -F " " -d "$TARGET_URL" -c "$0"' "$query" | LC_ALL=C sort)"
if $from_supabase; then
  source_counts="$(pg sh -c 'psql -At -F " " -d "$SOURCE_URL" -c "$0"' "$query" | LC_ALL=C sort)"
  if [ "$source_counts" != "$target_counts" ]; then
    diff <(echo "$source_counts") <(echo "$target_counts") >&2 || true
    echo "the row counts differ (left Supabase, right this server)" >&2
    false
  fi
  echo "$(wc -l <<<"$target_counts") tables, $(awk '{s += $2} END {print s}' <<<"$target_counts") rows, the same on both sides"
else
  echo "$(wc -l <<<"$target_counts") tables, $(awk '{s += $2} END {print s}' <<<"$target_counts") rows"
fi

echo "== 5. Switch"
if ! $on_db; then
  sudo sed -i -e 's/^DATABASE_URL=/#SUPABASE_DATABASE_URL=/' backend.env
  echo "DATABASE_URL=postgresql+asyncpg://exlibris:$app_password@db:5432/exlibris" | sudo tee -a backend.env >/dev/null
fi
switch_back() {
  echo "failed after the switch: back to Supabase" >&2
  sudo sed -i -e '/^DATABASE_URL=/d' -e 's/^#SUPABASE_DATABASE_URL=/DATABASE_URL=/' backend.env
  docker compose up -d --force-recreate backend >&2
}
$on_db || trap switch_back ERR
docker compose up -d --force-recreate backend
for _ in $(seq 1 40); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q backend)")" = healthy ] && break
  sleep 3
done
# /health touches no database: read through the app's own engine.
docker compose exec -T backend python - <<'PY'
import asyncio
from sqlalchemy import text
from app.db.session import engine

async def main() -> None:
    async with engine.connect() as connection:
        rooms = (await connection.execute(text("SELECT count(*) FROM rooms"))).scalar_one()
        print(f"the backend reads the new database: {rooms} rooms")

asyncio.run(main())
PY
trap - ERR
echo "done: the backend now uses the database on this server"
