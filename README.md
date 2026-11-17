# Ex Libris

Ex Libris (https://exlibris.world) is a web app where the members of a tabletop RPG campaign build and maintain the
notes and lore of that campaign together: places, NPCs, events, artifacts and
anything else worth recording. Each campaign is a **Room**; the Game Master
(the *Master*) and the players work in it, with fine-grained control over who
can see which piece of information. The notes are meant to become a knowledge
base that can later feed AI agents, scoped to what the asking user may see.

## What it does

- Sign in with Google, Discord or GitHub; edit a profile (name,
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
| [backend/](backend/README.md) | FastAPI service (Python, SQLAlchemy async, Alembic) |
| [backend/migrations/](backend/migrations/README) | Database migrations |
| [context/](context/) | Product and engineering docs, feature specs, progress tracker |
| `.github/workflows/ci.yml` | CI: lint, type-check, tests with exact-100% coverage gates |

## Architecture in short

- The **frontend never talks to the database or Storage directly**. It calls the
  backend with the user's access token, which the backend itself issues after
  an OAuth sign-in (Google, Discord or GitHub).
- The **backend** verifies the token, applies the visibility and ownership rules
  (all in `backend/app/domain/`), and talks to Postgres through SQLAlchemy.
- **Postgres** and **Garage** (an S3 service, for images and PDFs in a private
  bucket served through short-lived signed links) run next to the backend on
  each server.
- Every table is backend-only: Row Level Security is on with a deny policy for
  the client roles of the Supabase era, as a safety net.

More in [context/architecture.md](context/architecture.md).

## Running it locally

You need Node 24, Python 3.12 or newer, a Postgres 17 database, an OAuth app
for at least one provider (redirect URI
`http://localhost:8000/auth/<provider>/callback`) and, to upload images, an S3
service with a private bucket named `document-images` (Garage, as on the
servers, or any other).

1. **Backend**

   ```bash
   cd backend
   python -m venv .venv
   # activate it (.venv\Scripts\activate on Windows, source .venv/bin/activate elsewhere)
   pip install -e ".[dev]"
   cp .env.example .env        # fill in DATABASE_URL, AUTH_TOKEN_SECRET, a provider, S3_*
   alembic upgrade head        # see backend/migrations/README
   uvicorn app.main:app --reload
   ```

   The API runs on <http://localhost:8000> and `GET /health` needs no auth.
2. **Frontend**

   ```bash
   cd frontend
   npm ci
   cp .env.example .env        # VITE_API_BASE_URL, http://localhost:8000 by default
   npm run dev
   ```

   The app runs on <http://localhost:5173>, which is the backend's default
   allowed CORS origin.

On the maintainer's machine `.env` holds production values, with staging and
dev in `.env.staging` and `.env.dev`; see `context/architecture.md` → Local env
files before running migrations or tests.

Environment variables are listed in `backend/.env.example` and
`frontend/.env.example`. `DATABASE_URL` must use the `postgresql+asyncpg://`
scheme.

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

Everything runs on two OVHcloud VPSes, each with Docker behind Caddy (files in
`deploy/`): the frontend, the backend, Postgres and Garage. There are two
environments:

- **Production** (branch `main`): the frontend at `https://exlibris.world`, the
  backend at `https://api.exlibris.world`. After CI passes on `main`,
  `.github/workflows/deploy-prod.yml` builds the backend image and the
  frontend, pushes the image to GHCR and deploys both over SSH.
- **Staging** (branch `staging`): the same on the second VPS, at
  `https://staging.exlibris.world`, deployed by `deploy-staging.yml`.

Each server's settings live in `/opt/exlibris/backend.env` and `.env` there.

Neither environment's settings are in this repo; see
`context/architecture.md` → Environments, and `context/vps-migration-plan.md`
for operating the production server (deploys, rollback, logs). **Apply new
migrations to an environment's database before merging the code that needs
them into its branch**, because the backend redeploys on merge.

## Working on it

Start with [CLAUDE.md](CLAUDE.md) and the files in [context/](context/). Feature
specs are in `context/feature/` and current status is in
[context/progress-tracker.md](context/progress-tracker.md).

In Claude Code on the web, `.claude/hooks/session-start.sh` prepares each new
session to run all the checks above: it installs both sides' dependencies and
sets up a local Postgres the way CI does.

## License

Ex Libris is source-available under the [Functional Source License, Version
1.1, ALv2 Future License](LICENSE) (`FSL-1.1-ALv2`). You may read, run, modify
and share the code for any purpose except a Competing Use: offering it, or a
product built on it, as a commercial service that substitutes for Ex Libris.
Each version becomes available under the Apache License 2.0 two years after
its release. Bundled fonts keep their own licenses (SIL Open Font License 1.1,
next to the files).
