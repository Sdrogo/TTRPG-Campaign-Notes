# Progress Tracker

Update this file after every meaningful implementation change. Keep entries
short: a few lines per unit, with the *why* and anything a future session
must know. The full per-unit history (test counts, headless-check logs,
step-by-step notes) is in
[`archive/progress-tracker-full-2026-09-30.md`](archive/progress-tracker-full-2026-09-30.md)
— read it only when you need that detail.

## Current Status (2026-10-08)

**Spec 32, mention hover preview, built on 2026-10-12** at the product
owner's request (frontend only, no migration, no backend): on the Document
page, resting a mouse on a linked `#Document` mention for 400 ms shows that
Document's `DocumentCard` (`DocumentMentionPreview`, a Mantine `HoverCard`).
It reuses the Document the mention resolved against (the viewer's filtered
list), so it adds no request and can't reveal a hidden Document. Nothing on
touch screens or for Tag mentions. Decisions to confirm in its PR.

**Spec 31, personal data and GDPR, built on 2026-10-09** at the product
owner's request ("the app should comply with the GDPR"), after an audit of what
the app stores and where (in the spec). Backend: `GET /account/export` (the
caller's data as JSON) and `DELETE /account` (solo Rooms deleted, shared Rooms
left with the D-16 guard, personal rows and the Supabase Auth account erased,
content in shared Rooms kept as an unknown user). Frontend: "Your data" on the
Account page and the public `/privacy` notice (Italian and English, draft).
No migration. Merged into `staging` with PR #150. On 2026-10-09 the product
owner confirmed the account deletion rules (solo Rooms deleted, D-16 guard,
profile, avatar, Friends and sign-in account erased) and gave the controller
details now in the notice. **Before a release**: their legal review of the
notice and the DPAs with Supabase, OVHcloud and Vercel.

**Spec 30, read aloud, built on 2026-10-09** at the product owner's request
(frontend only, no migration): Documents (name, description, visible
Notes), single Notes and single Comments read by the browser's speech
synthesis, with Pause/Resume/Stop; voice and speed on the Account page,
per device. Decisions to confirm in its PR.

**Backlog review on 2026-10-08** (product owner): tickets **25 and 25b dropped**
(the Tags section, 25c, and the Account page, PR #123, were already reworked;
both files kept, marked dropped). **27b (PDF of one Document) is still
wanted.** New feature **28 - Relationship maps** (ticket written 2026-10-08,
Decisions to confirm in its PR): free boards per Room where members place
Documents, text cards and groups and draw labeled arrows that belong to that
map only (product owner's choice: no Room-wide relationships). Adds a
migration and the `@xyflow/react` dependency. The ticket also adds a
**Document subtitle** (28_0, built first: under the name, which grows one
typography level on the Documents list). Order: 27b, then 28.
**Spec 29, image search, built on 2026-10-08** at the product owner's
request (spec merged with PR #141; Pinterest has no public search API): a
"Cerca" picker over Openverse in the Document's "Immagini" row. Backend
29_1 `GET /rooms/{id}/documents/{id}/image-search` (Owners and the Master,
in-memory throttle of 30 searches a minute per user, optional
`OPENVERSE_CLIENT_ID`/`OPENVERSE_CLIENT_SECRET`); frontend 29_2
`ImageSearchModal` and `useImageSearch`. No migration. Built ahead of 27b
and 28 at the product owner's request.

**Spec 27 (Document export and import) built on 2026-10-08** (27_1 export of
one Document, 27_2 import backend, 27_3 frontend), written the day before with
the product owner's answers to its Open Questions. A member exports one
Document as JSON or Markdown (the Room export holding that Document alone); a
member who may create Documents imports one or more from JSON or Markdown, a
whole Room export included, through a preview and a background job; Documents
that exist in the Room are copied or replaced (information only). It carries
**migration `f7a2d8c4e1b9`** (`import_jobs`): **applied to the staging
database on 2026-10-08** (`.env.dev` and `.env.staging` point at the same
Supabase project, so the dev run was the staging one; `alembic current` reads
`f7a2d8c4e1b9`). **To do by the product owner: apply it to production before
the next release** (`alembic upgrade head` with `.env` loaded,
`architecture.md` → Local env files). 27b (a PDF of one Document) is
still to do. Backend 1074 tests passing (20 skipped without Pango), every
new module at 100% (`app/pdf/render.py` is only covered in the Docker image, as
before), `ruff` and `mypy` clean; frontend 1526 tests at 100% coverage, build
and lint clean.
**Production moved to `exlibris.world` on 2026-10-08**: the backend runs on
an OVHcloud VPS (`api.exlibris.world`, deployed by
`.github/workflows/deploy-prod.yml` after CI on `main`), the frontend is on
`exlibris.world` / `www.exlibris.world` (Vercel), Render production is
suspended for rollback. Staging is unchanged (Render + Vercel Preview + its
own Supabase). Operating notes: `vps-migration-plan.md` §12. Older entries
below that describe production on Render are history.

**Spec 26 (Room image) built on 2026-10-07** at the product owner's request: a
Room can have an image, set in the create dialog or on the setup page
(Administrators), and it is the default cover of the Room PDF. It carries
**migration `e9b4c2d7a1f6`** (`rooms.image_path`). **Applied to the staging
database by hand on 2026-10-07** (`.env.staging` exported, `alembic upgrade
head`: `c7d3e9a1f5b2` → `e9b4c2d7a1f6`, confirmed with `alembic current`).
**Applied to the production database by hand on 2026-10-07** too (`.env`
exported, run from a worktree of `origin/staging`, same step, confirmed with
`alembic current`): no pending migrations, and the next release to `main`
needs no migration step for it.

**Spec 25c (Room setup Tags and rename) built on 2026-10-07, ahead of 25 and
25b** at the product owner's request ("refactor the Tags section like the
Document page"). One PR into `staging`: `PATCH /rooms/{id}/tags/{tag}` (rename,
Administrator or Master; no migration) and the new `TagsSection` (Grouping
saved on every change, All Tags with filter, create, rename in place, delete).
It builds the shared `CompactList` that spec 25 describes; 25's theme-wide
density rules and 25b (Account page) are still to do. Backend 1008 tests,
frontend 1475 tests, both at 100% coverage.


**Features 12 to 24 are all built except 23c (Agent access tokens), which the
product owner dropped on 2026-10-06** (FR-G2 not built; the ticket stays in
`context/feature/` marked dropped). The two small tickets planned after 24
(default Tags in the creator's language, read-only members list) are still
open, not written yet; their place relative to feature 25 is to confirm. **Next: feature 25, a compact UI/UX
refactor** (tickets written 2026-10-06): `25 - Compact layout` (density rules
for every page), `25b - Compact Account page` (cards in columns), `25c - Room
setup Tags and rename` (one Tags section, rename a Tag, create one there),
built in that order.

**Migrations `a2e6c9f4b8d1` (version history, spec 24_1) and `c7d3e9a1f5b2`
(whole-Document history, spec 24b) applied to the production database by hand
on 2026-10-06** by the product owner, before the release (`.env` loaded,
`alembic upgrade`: `d9a4f1c7e3b5` → `a2e6c9f4b8d1` → `c7d3e9a1f5b2`). Production
and staging were both at `c7d3e9a1f5b2` (checked with `alembic current` on
each) at that point; since 2026-10-07 both are at `e9b4c2d7a1f6` (spec 26).

**Whole-Document history (spec 24b, 2026-10-06)** carries **migration
`c7d3e9a1f5b2`** (folds `note_versions` into `document_versions.notes` and
drops it). **Applied to the staging database by hand on 2026-10-06** by the
product owner (`alembic current` went from `a2e6c9f4b8d1` to `c7d3e9a1f5b2`;
checked afterwards: staging held 2 revisions and no Notes, so the backfill fix
of the review, Notes seeded from their creation, made no difference there).
**Applied to production by hand on 2026-10-06** (see above).

**Release of 2026-10-05 (staging → main, features 21, 22b follow-ups, 23 and 23b)**:
both pending migrations were applied to the **production** database by hand
before the release, with the product owner's go-ahead (`.env` loaded,
`alembic upgrade head`: `b8d2f6a4c9e1` → `c4e9a7f1d3b2` full-text search →
`d9a4f1c7e3b5` export jobs; checked: RLS on `export_jobs` with the deny policy,
its partial unique index, `unaccent` present). The live database is at
`d9a4f1c7e3b5`; no pending migrations. **The Room PDF needs the Docker backend
in production**: the product owner created the Docker web service
`exlibri-prod-docker.onrender.com` and will point the production frontend's
`VITE_API_BASE_URL` (Vercel) at it after the merge; until then the production
backend (Render's native runtime, no Pango) answers the PDF routes but its
jobs fail. When last checked from outside (2026-10-05) the new service did
not answer `/health` within 55 seconds: confirm it is up before switching.

**Feature 21 (full-text search) is built**: 21_1 and 21_2 in one PR into
`staging`. It carries **migration `c4e9a7f1d3b2`** (the `unaccent`
extension, a text search configuration and generated search vectors with GIN
indexes on `documents`, `document_notes`, `posts`, `tags`), **applied to the
staging database by hand on 2026-10-05** (from a worktree of the PR's branch,
with `.env.staging` loaded; `alembic current` read `c4e9a7f1d3b2`, it was at
`b8d2f6a4c9e1`) and, since the release above, on production too. Backend 827
tests, frontend 1359 tests, both at 100% coverage.

Staging released to `main` with PR #73 (specs 20_1/20_2, PRs #68 to #72).
Backend **754** tests at 100% coverage. The live database is at
`b8d2f6a4c9e1` (applied by hand 2026-10-03; `d7b3a9f2c5e8` before it converted
77 texts to `#` tokens, 204 `document_mentions` rows). No pending migrations.

Specs 12 to 20 are merged into `staging` (features 19 and 20 closed). All
Open Questions closed 2026-10-03. Feature 22 started before 21 at the
product owner's request (2026-10-03); 21 (full-text search) is still to do.

**Migration `b8d2f6a4c9e1`** (spec 22_1: `rooms.default_visibility`,
`reveals`, `reveal_recipients`, an `audit_log` index) **applied to the live
database by hand on 2026-10-03**, before the release that ships 22_1 (one
transaction, `alembic_version` updated; checked: RLS + deny policy on both new
tables, existing Rooms at `room`). All of feature 22 (22_1, 22_2, 22b_1,
22b_2) is in PR #86; 22b adds no migration.

**Staging environment (2026-10-04)**: a second Render service deploys
`staging` after CI passes, backed by a **separate Supabase project** (product
owner's choice, 2026-10-04); the staging frontend is the Vercel Preview of
`staging`. Setup and the migration flow for both databases are in
`architecture.md` → Environments. The staging database starts empty and is
brought to head with `alembic upgrade head`. **Since 2026-10-05 the staging
backend is a Render Docker service** (`ttrpg-campaign-notes-2.onrender.com`),
needed for the Room PDF; production is still on Render's native runtime until
the release that ships the PDF (open decision: new Docker service and URL, or
the Render API on the existing one).

**Local env files (2026-10-04)**: on the product owner's machine `.env` is
**production**; staging and dev live in `.env.staging` and `.env.dev`. The
backend and Vite only read `.env` by default, so those must be loaded
explicitly (`architecture.md` → Local env files).

**Production backend on a VPS (started 2026-10-07)**: at the product
owner's request, `context/vps-migration-plan.md` plans moving production off
Render onto a VPS running the backend image (staging stays on Render, the
database on Supabase). Done on 2026-10-08 by the product owner: domain
`exlibris.world`, `api.exlibris.world` on the Render production service and
in the production frontend's `VITE_API_BASE_URL`, an OVHcloud VPS hardened and
reachable as `api-vps.exlibris.world`. In the repository: `deploy/`
(`compose.yaml`, `Caddyfile`, `deploy.sh`) and `.github/workflows/deploy-prod.yml`
(GHCR image per commit, SSH deploy after CI on `main`, off until the
`VPS_DEPLOY_ENABLED` variable). Next: server setup and the first deploy, the
test on `api-vps`, the DNS switch (plan §9); the frontend on `exlibris.world`
(§10). Production traffic is still served by Render.

2026-10-08: first VPS deploy from `main` succeeded (`api-vps.exlibris.world`
healthy); production traffic is still on Render. Testing it showed both
backends together exceeding the Session Pooler's 15 clients
(`EMAXCONNSESSION`), so the DB pool is now capped at 5 + 2 per process
(`DB_POOL_SIZE`, `DB_MAX_OVERFLOW`); needs a release to `main` to reach
the VPS. **Cutover done on 2026-10-08 (~02:30 UTC)**: Render
production suspended (kept for rollback), `api.exlibris.world` A/AAAA → VPS,
Caddy serving both names. Production runs only on the VPS.
The pool cap reached the VPS with the next release; that deploy's
outside health check failed only because `api-vps.exlibris.world` no longer
resolved, so the check now calls `api.exlibris.world` at the VPS's IP
(`curl --resolve`) and needs no second name in DNS.
must know. Full per-unit history (test counts, decisions taken while
building, headless-check logs) is archived; read it only when you need that
detail:

- [`archive/progress-tracker-full-2026-10-10.md`](archive/progress-tracker-full-2026-10-10.md):
  everything up to 2026-10-10 (specs 12 to 31).
- [`archive/progress-tracker-full-2026-09-30.md`](archive/progress-tracker-full-2026-09-30.md):
  the original log up to 2026-09-30 (specs 01 to 11).

## Current Status (2026-10-10)

- **Everything on `staging` is released to `main`** (release PR #155,
  2026-10-10). Features 12 to 31 are built except the ones listed under
  Next Up; 23c, 25 and 25b were dropped by the product owner.
- **Latest work**: spec 31 (GDPR: `GET /account/export`, `DELETE /account`,
  public `/privacy` notice, PR #150, controller named in PR #152) and spec
  30/30b (read aloud with the browser's voices, best installed voice by
  default, first reading waits for the voice list, PRs #146, #148, #154).
  Neither has a migration.
- **Spec 31, still owed by the product owner**: legal review of the
  `/privacy` notice and the DPAs with Supabase, OVHcloud and Vercel. It
  shipped to production with the 2026-10-09/10 releases before those were
  done. Keeping shared content anonymised after an account deletion is the
  default in place, not explicitly confirmed. Any new table that stores a
  user id must be added to `account_repo.erase_personal_rows`
  (`architecture.md` → Personal data).
- **Test baseline**: backend and frontend both at 100% coverage with exact
  CI gates; `ruff`, `mypy`, `tsc`, lint and build clean.

## Migrations and Releases

Alembic migrations are **not** applied on deploy: the product owner applies
them by hand (`alembic upgrade head` with the matching env file loaded,
`architecture.md` → Local env files and → Environments). Staging gets a
migration before its PR merges into `staging`; production gets it before the
release to `main` that ships it. Before any release, list what is pending
here and remind the product owner.

- **Head in the repository**: `f7a2d8c4e1b9` (`import_jobs`, spec 27).
- **Staging database**: `f7a2d8c4e1b9` (applied 2026-10-08).
- **Production database**: `f7a2d8c4e1b9` (applied by hand 2026-10-08).
- **Pending migrations: none.** Feature 28 (Relationship maps) will add one.

Recent chain, newest first (where each came from):
`f7a2d8c4e1b9` import jobs (27_2) ← `e9b4c2d7a1f6` `rooms.image_path` (26)
← `c7d3e9a1f5b2` whole-Document history (24b, folds `note_versions` into
`document_versions.notes`) ← `a2e6c9f4b8d1` version history (24_1) ←
`d9a4f1c7e3b5` export jobs (23b_1c) ← `c4e9a7f1d3b2` full-text search (21_1,
`unaccent` + search vectors) ← `b8d2f6a4c9e1` Reveals and Room default
visibility (22_1) ← `d7b3a9f2c5e8` mention tokens (20_1).

Lesson: a release on 2026-10-02 shipped with an unapplied migration
(`f4c7a1d9e2b6`) and broke Comments in production.

## Environments (summary)

Details in `architecture.md` → Environments and `vps-migration-plan.md` §12.

- **Production**: backend on an OVHcloud VPS (`api.exlibris.world`, Docker
  image from GHCR, deployed by `.github/workflows/deploy-prod.yml` after CI
  on `main`, Caddy for HTTPS; cutover 2026-10-08). Frontend on Vercel at
  `exlibris.world` / `www.exlibris.world`. Render production is suspended,
  kept for rollback. DB pool capped at 5 + 2 per process (`DB_POOL_SIZE`,
  `DB_MAX_OVERFLOW`) because Supabase's Session Pooler allows 15 clients.
  The deploy health check calls `api.exlibris.world` with `curl --resolve`
  at the VPS's IP.
- **Staging**: Render Docker service (`ttrpg-campaign-notes-2.onrender.com`)
  deployed from `staging` after CI, Vercel Preview of `staging`, its own
  Supabase project. `.env.dev` and `.env.staging` point at the same staging
  project.
- **Local env files**: `.env` is **production**; `.env.staging` and
  `.env.dev` must be loaded explicitly (`architecture.md` → Local env files).
- The Room PDF needs the Docker image (WeasyPrint + Pango). WeasyPrint does
  not run on the product owner's Windows machine, so CI and the image are the
  only places PDFs render.

## Completed Units

One line per unit; dates 2026, newest first. Spec files live in
`context/feature/`; details in the archives above and in `architecture.md`.

### 2026-10-08 → 10-10

- **Read aloud, first reading waits for voices** (30b, 10-10): Chrome's
  `getVoices()` is empty until loaded, so `useReadAloud` primes the list and
  `playSpeech` waits for `voiceschanged` (≤ 1.5 s).
- **GDPR** (31, 10-09): data export, account deletion (solo Rooms deleted,
  D-16 guard on shared ones, personal rows and the Auth account erased,
  shared content kept as an unknown user), `/privacy` notice in it/en.
- **Better voices** (30b, 10-09): "Automatica" picks the best installed
  voice (`voiceScore`/`rankVoices`); the Account page lists voices best
  first. A server voice (Piper or cloud TTS) is the next step if needed.
- **Read aloud** (30, 10-09): Web Speech API, no backend. Documents (name,
  description, visible Notes), single Notes and Comments; Pause/Resume/Stop;
  voice and speed per device in `localStorage`. Not done: whole-thread
  reading, sentence highlight.
- **Image search** (29, 10-08): "Cerca" picker over Openverse in the
  Document's "Immagini" row; `GET .../image-search`, Owners and the Master,
  30 searches a minute per user, optional `OPENVERSE_CLIENT_ID`/`_SECRET`.
- **Mentions follow renames** (bug, 10-08): edit boxes show tokens under the
  target's current name; "Mentioned in" excerpts are recut at read time.
  Search excerpts and the history diff still use stored names.
- **Image upload in the info panel** (10-08): "Immagini" row above "File",
  "Carica immagini" and "Da URL", visible without edit mode; buttons wrap on
  narrow windows.
- **Room PDF dialog fixes** (10-08): chosen style card highlighted; PDF
  attachments with only an owner password are now read.
- **Import keeps images after links expire** (10-08): images from this app's
  own bucket are read straight from Storage when the importer can see them.
  Cross-environment imports still need fresh links.
- **Document export and import** (27, 10-08): export one Document (JSON or
  Markdown); import Documents from JSON/Markdown (a Room export too) through
  a preview, Copy/Replace, and a background job. Migration `f7a2d8c4e1b9`.
  Decision to confirm: the import keeps the file's visibility levels since
  creation has no rule stopping a Player from setting Master-only.

### 2026-10-05 → 10-07

- **Room image** (26 + Room card follow-up, 10-07): `rooms.image_path`
  (migration `e9b4c2d7a1f6`), set by Administrators, default PDF cover,
  shown on the Room card.
- **Room setup Tags and rename** (25c, 10-07, PR #122): `PATCH
  /rooms/{id}/tags/{tag}`, `TagsSection`, shared `CompactList`.
- **Account page avatar block** (10-07): 200px avatar, centered actions.
- **Whole-Document history** (24b, 10-06): one revision history per
  Document (name, description, every Note); migration `c7d3e9a1f5b2`.
- **Version history** (24_1, 24_2, 10-05): drawer with word diff and
  Restore; edits by the same editor within 10 minutes merge. Migration
  `a2e6c9f4b8d1`. Not seen in a browser.
- **Room PDF** (23b_1a to 23b_2 and follow-ups, 10-05 → 10-06): Docker
  backend image; `app/domain/manual.py` + `app/pdf/` (WeasyPrint, Gothic,
  Modern, Print, A4/Letter); background jobs (`export_jobs`, migration
  `d9a4f1c7e3b5`, files kept 24 h); dialog with style cards; two balanced
  columns; one page per Document, two short ones may share a page; Notes as
  paragraphs, Comments (only those written as a Character) as boxed
  sidebars; glossary of Document names; no drop cap on a leading mention.
- **Room export** (23_1 to 23_3, 10-05): `GET /rooms/{id}/export`, JSON or
  Markdown, only what the requester sees, Markdown names escaped.
- **Full-text search** (21_1, 21_2, 10-05): accent/case-insensitive prefix
  search over Documents, Notes, Comments, Tags; `Ctrl+K` modal. Migration
  `c4e9a7f1d3b2`.

### 2026-10-01 → 10-04

- **View as a member** (22b, 10-03): `X-View-As` header for the Master,
  every write refused; banner with "Exit".
- **Reveal and visibility history** (22_1, 22_2, 10-03): Reveal on
  Documents, Notes, Comments; badge of unseen Reveals; History tab;
  `rooms.default_visibility`. Migration `b8d2f6a4c9e1`.
- **Open questions closed** (10-03): all 15 answered; `requirements.md`
  v0.5; no other user's email is ever sent; Facebook and X sign-in removed.
- **UI restyle** (10-03, PRs #81 to #85): Room page and top bar refactor
  (floating "+"), top bar pinned and hiding on scroll down, Document info
  panel, card restyle and more columns on wide screens, unread dot in the
  visibility badge, accessibility audit fixes.
- **Mention backlinks** (20_1, 20_2, 10-03): "Mentioned in"; mentions
  stored as tokens (migration `d7b3a9f2c5e8`).
- **Comments, feature 19** (10-02 → 10-03): threaded replies (19), unread
  replies (19b), reactions, pin and resolved, @mentions, promotion to a
  Note (19c_1 to 19c_8). Thread pagination (FR-T3) parked.
- **Friends and direct invitations** (18_1a, 18_1b, 18_2, 10-02).
- **Characters** (17, 10-01) and **PDF Attachments** (16, 10-01).
- **Leave Room** (15), tests moved to `src/test/` (14), Room and Tag
  deletion (13_1a to 13_1c), Notes on Documents (12_1, 12_2), Tag
  combinations (11_2), Index follows the Main items (11_3) (09-30 → 10-01).
- **Infrastructure**: Claude code review replaces CodeRabbit (PR #49),
  API errors follow the UI language, Claude Code on the web session setup,
  staging environment with its own Supabase project (10-04), `/health`
  answers HEAD (10-03).
- **Small fixes** (10-01): invite link survives sign-in, Room card
  navigation feedback, nullable Note mutation responses, Note reorder
  reload, Room deletion locks the Room before its Documents.

### 2026-09-21 → 09-30

Foundations, Documents and Comments, Account and security (private bucket,
RLS lockdown), Documents list and CI, localization (it/en), UX refinement
(spec 10), Room setup page (spec 11). See the 2026-09-30 archive.

## Next Up

- **27b, PDF of one Document**: next to build (product owner,
  2026-10-08).
- **28, Relationship maps**: after 27b. Starts with 28_0 (Document
  subtitle). Free boards per Room with Documents, text cards, groups and
  labeled arrows that belong to their map only; adds a migration and
  `@xyflow/react`. `requirements.md` needs a new `FR-`/`VR-` entry once the
  ticket is approved (product owner's edit only).
- **Two small tickets, not written yet**: default Tags in the creator's UI
  language (decided 2026-10-03), and a read-only members list for every
  member (the setup page stays Administrator-only).
- **Browser walk-through** (product owner): several features are built and
  unit-tested but never seen running: Notes (12), PDF Attachments (16),
  Characters (17), Friends (18), mention backlinks (20), search (21),
  version history drawer (24), Room export download and PDF dialog at phone
  width (23), early card and modal UI (07, 13). The full checklist is in the
  2026-10-10 archive under Next Up. A Playwright script is possible on
  request.
- **Parked**: Thread pagination (FR-T3), until Threads get long in practice.
- **Ops, later**: delete the suspended Render production and old native
  staging services after quiet weeks; backups and monitoring for the VPS
  (`vps-migration-plan.md` §7/§8).
- **Decisions taken while building, still to confirm**: many units list
  "choices beyond the ticket" (specs 21 to 27); they are in the 2026-10-10
  archive under each unit.

## Open Questions

None. The 15 questions open at the time were closed with the product owner
on 2026-10-03; the spec changes are in `requirements.md` v0.5.

## Architecture Decisions

Full reasoning lives in `architecture.md`; this is the index.

- Stack: React + Vite + TS, FastAPI, Supabase (Postgres + Auth + Storage) —
  managed infra for a small team.
- The frontend never talks to Postgres/Storage directly; visibility and
  ownership rules live only in `backend/app/domain/`. RLS is a safety net
  (deny-all for clients), not the primary mechanism.
- Mono-repo (`/frontend`, `/backend`, `/context`).
- Backend uses SQLAlchemy async + Alembic, not Supabase's REST client; no FK
  to `auth.users` (→ Backend Data Access).
- Images are proxied through the backend (validate → downscale → WebP →
  upload with the secret key) rather than client-side signed uploads
  (→ Storage Model).
- Comment images are Document images linked by `document_images.post_id`,
  filtered per viewer by the Comment's visibility.
- User profiles live on the `users` mirror; avatars reuse the image pipeline
  with a square crop; the sweeper treats `users.avatar_path` as a reference.
- Private bucket + 1-hour signed links, signed in one batch per response —
  chosen over proxying image bytes (bandwidth, CDN).
- Storage consistency via a `storage_cleanup` outbox + post-commit removal +
  background sweep, not in-request compensation.
- Favorite image is an `is_favorite` flag with a partial unique index, not a
  `documents.favorite_image_id` FK: the state stays on the image (which is
  what is deleted, cascaded and filtered), and one `ORDER BY is_favorite
  DESC, created_at, id` serves every read path. "Exactly one while images
  exist" is application logic (`next_favorite_id`).
- "Main Tag" = a Tag with a non-NULL `tags.main_position`, chosen and
  ordered by a Room Administrator (spec 11; it was "category `Type`" in
  spec 10); the Glossary Index is a navigation over Tags, not the FR-N3/N4
  Glossary entity.
- Localization: frontend and backend each have their own resource files with
  the same shape and share no code; domain exceptions carry keys, rendered
  at the API boundary.
- Accepted limits: the signed-link cache and the Storage sweeper are per
  backend process (harmless with several workers; move the sweeper to a
  scheduled job if the backend goes serverless or scales out). A signed link
  already handed out works until it expires, and old public URLs may be
  served from the CDN cache for a while.
- A user's email is sent only to that user (NFR-03, 2026-10-03).

## Session Notes (lessons worth keeping)

- **Branch from `origin/staging`** (PRs target `staging` since 2026-10-01,
  see `code-standards.md`), or `git fetch` first — a branch cut from a
  stale local `main` once made merged files look reverted (nothing was lost).
- **Re-check a PR's merge state** (`gh pr view <n> --json state,mergedAt`)
  before pushing more commits to its branch after a gap. PR #19 was merged
  mid-session and follow-ups had to go out as PR #20.
- Adding a `NOT NULL` column to a table that has rows needs a hand-added
  `server_default` (autogenerate omits it).
- Phosphor icons: use the `*Icon`-suffixed exports (bare names are
  deprecated). Mantine v9 renamed `Grid`'s `gutter` to `gap`.
- Bash heredocs with backticks break; and `Path.write_text` without
  `encoding='utf-8'` **truncates the file** on a non-cp1252 character (it
  emptied `ui-context.md` once; restored from git). Always pass
  `encoding='utf-8'`. Prettier has no repo config: use
  `--single-quote --print-width 100` to match the code.
- Headless browser checks need a faked Supabase session (Google-only login
  can't be automated) and a stubbed API; the scripts were never committed,
  which is why several UI items still await a human look.
- `requirements.md` (v0.5) is the ID source for `D-`, `FR-`, `UC-`, `VR-`,
  `I-`, `OQ-`; it is protected, so spec gaps are logged under Open Questions
  rather than edited.
