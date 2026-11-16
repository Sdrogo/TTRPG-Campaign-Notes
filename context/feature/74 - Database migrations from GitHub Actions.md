# 74 - Database migrations from GitHub Actions

Status: **confirmed 2026-11-16** ("ok alle 3 opzioni": label `db-migration`,
the CI reminder, a required reviewer on the production button). **Built** in
PR #334.

Asked by the product owner on 2026-11-16: "possiamo scrivere un action su
github per fare le migrazioni del DB su staging e prod?", then "potremmo
scegliere di lanciarla al merge su staging o main se viene flaggato
qualcosa?".

## Goals

- Alembic migrations run from GitHub, not by hand from a laptop with a
  production `DATABASE_URL` loaded.
- They run only when the product owner says so: a label on the PR, or a
  button. Never silently.
- The same flow keeps working after ticket 73 step 5, when Postgres is on the
  VPS with no published port.

## Where we are

- Migrations are applied by hand (`cd backend && DATABASE_URL=<url> alembic
  upgrade head`): on staging before the PR that needs them is merged, on
  production before the release (`architecture.md` → Environments).
- The backend image leaves out `migrations/` and `alembic.ini`
  (`backend/.dockerignore`); `migrations/env.py` imports `app.config` and
  `app.db.models`, and one migration imports `app.domain.mentions`.
- Production deploys from `main` and staging from `staging`, both through
  `.github/workflows/deploy-vps.yml` (ticket 73).

## Decisions (proposed)

1. **Runs on the VPS, not on the GitHub runner.** The workflow copies the
   commit's `backend/migrations/` and `backend/alembic.ini` to
   `/opt/exlibris/migrations/` over the deploy SSH key and runs
   `docker compose run --rm` on the backend service, with those two mounted
   read-only into `/app`. The database URL never leaves the server's
   `backend.env`; GitHub holds no database secret; after step 5 the database
   needs no open port.
2. **Label `db-migration` on the merged PR.**
   - A PR merged into `staging` with the label: the staging deploy runs the
     migrations **before** switching the backend.
   - The release PR `staging` → `main` with the label: the same on
     production.
   - No label: no migration, as today.
   The deploy finds the PR from the commit (GitHub API, `commits/<sha>/pulls`)
   and reads its labels. A deploy started by hand (Run workflow) never
   migrates.
3. **Order inside the deploy**: pull the new image → `alembic current` and
   the pending revisions printed → `alembic upgrade head` with the **new
   image** (so a migration importing app code finds the code of the same
   commit) → backend switched → checks. A failed migration stops the deploy:
   the old backend keeps running, nothing is tagged. Migrations stay
   additive/backward compatible, as the code standards already require,
   because the old backend keeps serving during the migration.
4. **A manual button too**: workflow "Migrate database", inputs environment
   (`staging` / `production`) and ref (branch or commit, default the
   environment's branch). Same steps, with the image currently deployed on
   that server. Covers migrating staging before merging, as today.
5. **CI reminder**: on a PR that adds or changes a file under
   `backend/migrations/versions/` and has no `db-migration` label, a CI job
   fails with "add the db-migration label, or remove the migration". Adding
   the label re-runs it (`pull_request` `labeled` / `unlabeled` events).
6. **Production approval**: the label is the approval. Optionally the
   product owner can also add a required reviewer on the GitHub environment
   used by the manual button for production (`migrate-production-approval`, a job of its own before the one that uses
   `vps-production`), so
   the button waits for a click.
7. **Downgrades are not automated.** Rolling back a migration stays a
   by-hand step (`alembic downgrade`), documented in the runbook.

## Changes

- `.github/workflows/deploy-vps.yml`: input `migrate` (bool); a step before
  "Deploy on the VPS" that copies the migrations and runs them.
- `deploy-prod.yml` / `deploy-staging.yml`: a first job that reads the
  merged PR's labels and passes `migrate`.
- `deploy/deploy.sh`: a `migrate` sub-command (or `deploy/migrate.sh`) that
  runs `alembic current`, `alembic upgrade head`, `alembic current`.
- `.github/workflows/migrate-db.yml`: the manual button.
- `migration-label.yml` (its own workflow, so the `labeled`/`unlabeled`
  events don't re-run the whole CI): the label reminder.
- Docs: `architecture.md` (Environments, migrations bullet), `code-standards.md`
  if it mentions applying migrations, `vps-migration-plan.md` runbook,
  progress tracker; memory note that migrations are no longer by hand.

## Tests

- `deploy.sh`/`migrate.sh` with a stubbed `docker` (as for ticket 73):
  migration ok → deploy continues; migration fails → deploy stops, old
  backend untouched, `prod`/`staging` alias not moved.
- On staging, a no-op run (no pending revision) and a real one with the next
  migration that comes along.
- The CI reminder on a test PR with and without the label.

## Questions for the product owner (answered 2026-11-16: yes to all three)

1. Label name `db-migration`, fine?
2. The CI reminder (decision 5): wanted, or too strict?
3. Required reviewer on the manual production button (decision 6): yes or no?

Build time: about 1.5 h of Claude time.
