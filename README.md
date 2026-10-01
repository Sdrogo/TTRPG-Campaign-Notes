# TTRPG Campaign Notes

A web app where the members of a tabletop RPG campaign build and maintain the
notes and lore of that campaign together: places, NPCs, events, artifacts and
anything else worth recording. Each campaign is a **Room**; the Game Master
(the *Master*) and the players work in it, with fine-grained control over who
can see which piece of information. The notes are meant to become a knowledge
base that can later feed AI agents, scoped to what the asking user may see.

## What it does

- Sign in with Google, Discord, Facebook, GitHub or X; edit a profile (name,
  avatar, pronouns, bio).
- Create a Room, invite people by link, and manage members and roles.
- Documents with Tags, Owners, images, Notes and a Comment thread. Documents are
  grouped by "Main" Tags (and combinations of Tags) that a Room Administrator
  chooses on the Room setup page.
- Per-item **visibility** (Room, Master only, Private, Selective), enforced by
  the backend on every read path. A hidden item answers 404, never 403, so it
  leaves no trace.
- `#` mentions that link to Documents and Tags, in Italian and English.

Product details: [context/project-overview.md](context/project-overview.md).
The full spec is [context/requirements.md](context/requirements.md).

## Repository layout

| Path | What lives there |
| --- | --- |
| [frontend/](frontend/README.md) | React + Vite + TypeScript single-page app (Mantine UI) |
| [backend/](backend/) | FastAPI service (Python, SQLAlchemy async, Alembic) |
| [backend/migrations/](backend/migrations/README) | Database migrations |
| [context/](context/) | Product and engineering docs, feature specs, progress tracker |
| `.github/workflows/ci.yml` | CI: lint, type-check, tests with exact-100% coverage gates |

## Architecture in short

- The **frontend never talks to the database or Storage directly**. It calls the
  backend with the user's Supabase access token.
- The **backend** verifies the token, applies the visibility and ownership rules
  (all in `backend/app/domain/`), and talks to Postgres through SQLAlchemy.
- **Supabase** provides Postgres, Auth and Storage (images live in a private
  bucket and are served through short-lived signed links).
- Every table is backend-only: Row Level Security is on with a deny policy for
  Supabase's client roles, as a safety net.

More in [context/architecture.md](context/architecture.md).

## Running it locally

You need Node 24, Python 3.12 or newer, and a Supabase project (Postgres, Auth
with at least one provider, and a private Storage bucket named `document-images`).

1. **Backend**

   ```bash
   cd backend
   python -m venv .venv
   # activate it (.venv\Scripts\activate on Windows, source .venv/bin/activate elsewhere)
   pip install -e ".[dev]"
   cp .env.example .env        # fill in SUPABASE_URL, SUPABASE_SECRET_KEY, DATABASE_URL
   alembic upgrade head        # see backend/migrations/README
   uvicorn app.main:app --reload
   ```

   The API runs on <http://localhost:8000> and `GET /health` needs no auth.
2. **Frontend**

   ```bash
   cd frontend
   npm ci
   cp .env.example .env        # fill in the Supabase URL and publishable key
   npm run dev
   ```

   The app runs on <http://localhost:5173>, which is the backend's default
   allowed CORS origin.

Environment variables are listed in `backend/.env.example` and
`frontend/.env.example`. `DATABASE_URL` must use the `postgresql+asyncpg://`
scheme; Supabase's Session Pooler works where the direct host is IPv6-only.

## Checks

Run these before opening a PR. CI runs the same ones.

| Check | Command (from the folder) |
| --- | --- |
| Frontend lint | `npm run lint` |
| Frontend build and type-check | `npm run build` |
| Frontend tests with coverage | `npm run test:coverage` |
| Backend lint | `ruff check .` |
| Backend types | `mypy app tests` |
| Backend tests with coverage | `pytest --cov=app --cov-fail-under=100` |

Both sides hold 100% coverage. Without a database you can still run
`pytest -m "not integration"`. See [context/code-standards.md](context/code-standards.md)
for the conventions.

## Deployment

The frontend is deployed on Vercel and the backend on Render; Supabase hosts the
database. Production settings (including `CORS_ORIGINS`) live in those
dashboards, not in this repo. **Apply new migrations to the database before
merging the code that needs them**, because the backend redeploys on merge.

## Working on it

Start with [CLAUDE.md](CLAUDE.md) and the files in [context/](context/). Feature
specs are in `context/feature/` and current status is in
[context/progress-tracker.md](context/progress-tracker.md).

In Claude Code on the web, `.claude/hooks/session-start.sh` prepares each new
session to run all the checks above: it installs both sides' dependencies and
sets up a local Postgres the way CI does.
