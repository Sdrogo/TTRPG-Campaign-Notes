# Backend

The FastAPI service for TTRPG Campaign Notes. It is the only component that
talks to Postgres and Storage: it verifies the user's Supabase token and applies
every visibility and ownership rule before answering. Overview of the whole
project: [../README.md](../README.md).

## Stack

Python 3.12, FastAPI on uvicorn, SQLAlchemy 2.0 async with `asyncpg`, Alembic
for migrations, Pydantic settings, PyJWT (Supabase JWTs checked against the
project's JWKS), Pillow for images, WeasyPrint + Jinja2 + pypdf for the Room
PDF. Tests use pytest; lint and types use Ruff and mypy.

## Setup

```bash
python -m venv .venv
# activate it (.venv\Scripts\activate on Windows, source .venv/bin/activate elsewhere)
pip install -e ".[dev]"
cp .env.example .env
alembic upgrade head          # see migrations/README
uvicorn app.main:app --reload # http://localhost:8000, GET /health needs no auth
```

**`.env` on the maintainer's machine holds production values** (staging and dev
are in `.env.staging` and `.env.dev`). The app and Alembic only read `.env`, so
load the right file before running migrations, the full test suite or any
script: see [../context/architecture.md](../context/architecture.md) → Local
env files.

| Variable | Meaning |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL (JWKS for the tokens, Storage) |
| `SUPABASE_SECRET_KEY` | Supabase secret key, for Storage |
| `STORAGE_BUCKET` | Private bucket for images and files (`document-images`) |
| `DATABASE_URL` | `postgresql+asyncpg://…`, Supabase's **Session Pooler** (the direct host is IPv6-only) |
| `CORS_ORIGINS` | Exact allowed origins: a JSON list or comma-separated, no trailing `/` |
| `CORS_ORIGIN_REGEX` | Optional pattern for generated hosts (staging's Vercel Previews); blank = none |
| `DB_POOL_SIZE`, `DB_MAX_OVERFLOW` | Connections per process (5 + 2). The Session Pooler allows 15 per project across every backend on that database |

## Checks

| Command | What it does |
| --- | --- |
| `ruff check .` | Lint |
| `mypy app tests` | Types (strict) |
| `pytest --cov=app --cov-fail-under=100` | All tests; the `integration` ones need a Postgres in `DATABASE_URL`. Coverage must stay at 100% |
| `pytest -m "not integration"` | The tests that need no database |

## Layout (`app/`)

| Folder | Contents |
| --- | --- |
| `api/` | FastAPI routers, one per area; request and response models |
| `domain/` | The rules (visibility, ownership, roles), framework-free |
| `db/` | SQLAlchemy models, one `*_repo.py` per area, the session (`session.py`) |
| `auth/` | Supabase JWT verification and the current-user dependency |
| `pdf/` | Room PDF templates, styles and bundled fonts |
| `i18n/` | API error messages in Italian and English (`locales/`) |
| `config.py` | Every setting, read from the environment |
| `main.py` | App, CORS, routers, and the background sweepers started at startup |

Migrations are in `migrations/versions/` and are **applied by hand** to each
database, never on deploy ([migrations/README](migrations/README)).

Full rules: [../context/code-standards.md](../context/code-standards.md) and
[../context/architecture.md](../context/architecture.md).

## Deployment

The backend ships as the Docker image built from `Dockerfile` (Python 3.12 slim
plus Pango for WeasyPrint, runs as an unprivileged user, no `.env*` file in it;
CI's `Backend image` job builds it and renders a PDF inside it).

- **Production** runs it on a VPS at `https://api.exlibris.world`, behind Caddy
  (`../deploy/`). After CI passes on `main`,
  `../.github/workflows/deploy-prod.yml` pushes the image to GHCR and deploys it
  over SSH. Settings live in `/opt/exlibris/backend.env` on the server.
  Operating it (logs, settings, rollback):
  [../context/vps-migration-plan.md](../context/vps-migration-plan.md) §12.
- **Staging** runs it as a Render Docker service, deployed from `staging` after
  CI, with its settings in the Render dashboard.

Only one or two backend processes should run against the same database at a
time: each one starts the background sweepers, and at startup the Room PDF
sweeper fails every job still in progress.
