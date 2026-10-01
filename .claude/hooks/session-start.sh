#!/bin/bash
# Prepares a Claude Code on the web session to run every CI check:
# frontend and backend dependencies, plus a disposable local Postgres set up
# the way .github/workflows/ci.yml sets up its service container.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

LOCAL_DB_URL="postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/postgres"

# Frontend. `npm install` (not `ci`) reuses the cached node_modules.
(cd frontend && npm install --no-audit --no-fund)

# Backend, in the venv the README uses.
(
  cd backend
  [ -x .venv/bin/python ] || python3.12 -m venv .venv
  .venv/bin/pip install --quiet -e ".[dev]"
)

# Local Postgres, user and password as in CI.
service postgresql start
until pg_isready -h 127.0.0.1 -q; do sleep 1; done
su postgres -c "psql -q -c \"ALTER USER postgres PASSWORD 'postgres';\""
export PGPASSWORD=postgres
# The Supabase shim is not re-runnable, so apply it only to a fresh database.
if [ "$(psql -h 127.0.0.1 -U postgres -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'anon'")" != "1" ]; then
  psql -h 127.0.0.1 -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f backend/tests/ci/supabase_shim.sql
fi
# Always migrate the local database, never one from the environment's secrets.
(cd backend && DATABASE_URL="$LOCAL_DB_URL" SUPABASE_URL=http://supabase.invalid \
  SUPABASE_SECRET_KEY=ci-not-a-real-key .venv/bin/alembic upgrade head)

# Session settings matching CI. DATABASE_URL always points at the local
# database so tests can never write to the live Supabase one; the Supabase
# values from the environment's secrets, if any, are kept.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export DATABASE_URL=\"$LOCAL_DB_URL\""
    echo 'export SUPABASE_URL="${SUPABASE_URL:-http://supabase.invalid}"'
    echo 'export SUPABASE_SECRET_KEY="${SUPABASE_SECRET_KEY:-ci-not-a-real-key}"'
    echo "export PATH=\"$CLAUDE_PROJECT_DIR/backend/.venv/bin:\$PATH\""
  } >> "$CLAUDE_ENV_FILE"
fi
