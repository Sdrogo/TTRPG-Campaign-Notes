# Progress Tracker

Update this file after every meaningful implementation change. Keep it
short: **one or two lines per unit**, with the *why* and anything a future
session must know. Ticket detail belongs in the ticket (`context/feature/`),
design detail in `architecture.md` / `ui-context.md`. When this file grows
past ~400 lines, move the old detail to a new archive file and condense.

Full history is archived; read it only when you need that detail:

- [`archive/progress-tracker-full-2026-11-18.md`](archive/progress-tracker-full-2026-11-18.md):
  the log up to 2026-11-18 (specs 63 to 75 in their long form, ticket 73
  step by step, the old Next Up and Environments).
- [`archive/progress-tracker-full-2026-11-04.md`](archive/progress-tracker-full-2026-11-04.md):
  up to 2026-11-04 (specs 28 to 62: per-unit notes, every migration's apply
  history, Next Up as it stood).
- [`archive/progress-tracker-full-2026-10-10.md`](archive/progress-tracker-full-2026-10-10.md):
  up to 2026-10-10 (specs 12 to 31, browser walk-through checklist,
  "choices beyond the ticket" of specs 21 to 27).
- [`archive/progress-tracker-full-2026-09-30.md`](archive/progress-tracker-full-2026-09-30.md):
  the original log up to 2026-09-30 (specs 01 to 11).

## Current Status (2026-11-18)

- **Built**: features 01 to 75 (27b, 46b-d, 47b, 57b/c, 62b/c included);
  23c, 25 and 25b were dropped by the product owner; 46b (DDI invitation)
  is not written yet. Latest: 75 monitoring (PRs #339, #348), 73 step 6
  cleanup (PR #347), CI in parallel shards (PR #350).
  Image cache (2026-11-23): signed image links are now stable per UTC day (24-48 h) and objects get `max-age=86400`, so the browser stops re-downloading images every hour (see architecture.md, bucket is private).
  Claude review now skips Dependabot PRs (it cannot read Actions secrets
  there).
- **No more Vercel, Render or Supabase** (ticket 73, 2026-11-16 → 11-18):
  frontend, API, sign-in, files and database run on two OVH VPSes
  (production in Strasbourg, staging on the Erith VPS). Both Supabase
  projects are paused, to be deleted about mid-December 2026 after a last
  dump.
- **Release state** (2026-11-18): `staging` and `main` match. Last release
  PR #351 (v0.7.0: #347 cleanup and #350 CI shards, no migrations); the tag
  and GitHub release are made by the product owner locally (a tag pushed
  from a session does not work). Earlier releases since the last condensing:
  #306 (v0.4.0), #311, #316, #321, #329, #333, #335, #338, #341, #343, #345,
  #349. Dependabot PRs land on `main`: merge `main` into `staging` before
  opening a release PR.
- **Waiting on the product owner**: the external clean-up of ticket 73
  (Supabase deletion in December with its dumps on the servers, old OAuth
  redirect URLs at Google/Discord/GitHub, dropping Supabase from the privacy
  notice once deleted); GitHub private vulnerability reporting (72); review
  of 55 (Room landing); 52 live updates to test with two browsers; legal
  review of `/privacy` and the DPA with OVHcloud (spec 31, on hold).
  Keeping shared content anonymised after an account deletion is the
  default in place, not explicitly confirmed.
- **Test baseline**: backend and frontend both at 100% coverage with exact
  CI gates (applied by `Frontend coverage` / `Backend coverage` after the
  four shards); `ruff`, `mypy`, `tsc`, lint and build clean.
- **Personal data rule**: any new table that stores a user id must be added
  to `account_repo.erase_personal_rows` (`architecture.md` → Personal data).

## Migrations and Releases

Since 2026-11-17 (ticket 74) migrations run from GitHub Actions: a PR merged
with the `db-migration` label migrates staging, the release PR with the
label migrates production, and Actions → *Migrate database* runs them on
demand (`architecture.md` → Environments). Before any release, list what is
pending here and remind the product owner to label the release PR.

- **Head in the repository**: `c6f1a9d3e7b2` (request statistics and error
  events, ticket 75).
- **Staging database**: `c6f1a9d3e7b2 (head)`, 2026-11-17 from Actions (PR
  #339). Before: `b5e2c8f1a4d7`, 2026-11-17 (PR #337); `e7b3d9a1c5f2` and
  `d4a8f2c6b9e1` on 2026-11-09 by hand.
- **Production database**: `c6f1a9d3e7b2 (head)`, 2026-11-18 from Actions
  (release PR #349; the label was added just after the merge, before the
  deploy started, and the deploy migrated). Before: `b5e2c8f1a4d7`,
  2026-11-17 (release PR #338, 31 identities copied); `d4a8f2c6b9e1` then
  `e7b3d9a1c5f2` on 2026-11-09 by hand, before release PR #316.
- **Pending**: none. Releases #333, #335, #341, #343, #345 and #351 had no
  migration; ticket 73 step 5 moved each database as it was with
  `deploy/db-setup.sh` (dump, restore, row-count check).

When a new migration lands, update the three lines above and add it to the
top of the chain below. Per-migration apply history up to 2026-11-04 is in
the 2026-11-04 archive.

Chain, newest first (where each came from):
`c6f1a9d3e7b2` request stats (75) ← `b5e2c8f1a4d7` own sign-in (73 step 3) ← `e7b3d9a1c5f2` color legend and presets (68) ← `d4a8f2c6b9e1` arrow bend (67)
← `c1d7e3a9f5b2` Clocks (61) ← `e9c4a2f7b1d8` import job progress (59) ←
`e8c4a2f6b1d9` Section tools + block `collapsed`, drops
`rooms.maps_position` (60_2) ← `d5b8e1f3a9c7` Room landing page (55) ←
`c8f2d6a4e1b7` poll choice description (54) ← `b9e4c2a7d1f3` Session 0
polls (53) ← `a7d3f9b2c6e1` Session 0 DDI (47_3) ← `f3a9c1e7b5d4` Session 0
Questions (47_2) ← `e5c1a8f3b7d2` Session 0 chain (47_1) ← `d4a7e2c9f1b3`
post-it order (46d_2) ← `c3f8a1d6e9b4` colours and groups (46c) ←
`4797859660e2` Session 0 boards (46_1) ← `b5f1d8e3a7c2` room
maps_position (PR #236) ← `e2b7c4f9a1d6` map players_can_edit and revision
(42_1) ← `a4d9e2c7f1b6` note relational link (41_1) ← `d7c1f5a9e3b8`
geographic maps (38_1) ← `e8b4d2f6a9c1` document linked maps (36
Decision 15) ← `c6e2a9f4d8b3` mention maps (36_1) ← `b4d8f2a6c1e7` map
label offsets (28_3) ← `a9e3c5d7b1f4` map label positions (28_3) ←
`d5a1c8e3f2b7` map card image ← `b3f7d1e9c5a2` relationship maps (28_1) ←
`a8c4e2f6b1d3` Document subtitle (28_0) ← `f7a2d8c4e1b9` import jobs (27_2)
← `e9b4c2d7a1f6` `rooms.image_path` (26) ← `c7d3e9a1f5b2` whole-Document
history (24b) ← `a2e6c9f4b8d1` version history (24_1) ← `d9a4f1c7e3b5`
export jobs (23b_1c) ← `c4e9a7f1d3b2` full-text search (21_1) ←
`b8d2f6a4c9e1` Reveals and Room default visibility (22_1) ← `d7b3a9f2c5e8`
mention tokens (20_1).

Lesson: a release on 2026-10-02 shipped with an unapplied migration
(`f4c7a1d9e2b6`) and broke Comments in production.

## Environments (summary)

Details in `architecture.md` → Environments, `restore-runbook.md` and
`monitoring-guide.md`. `vps-migration-plan.md` is the 2026-10-08 history.

- **Production**: OVH VPS-2 in Strasbourg. Caddy serves the frontend
  (`exlibris.world`, `www` redirects) and the API (`api.exlibris.world`);
  backend image from GHCR, Postgres 17 (`db` compose profile), images on
  Garage (S3). Deployed by `deploy-prod.yml` → shared `deploy-vps.yml`
  after CI on `main`; docs-only merges skip the deploy.
- **Staging**: the older Erith OVH VPS, same stack (`staging.exlibris.world`,
  `api-staging.exlibris.world`), deployed by `deploy-staging.yml` after CI
  on `staging`. It also hosts the monitoring hub (Beszel, Uptime Kuma) and
  receives the nightly encrypted backups (database + bucket, `backup.sh`).
- **Sign-in**: the backend's own OAuth (Google, Discord, GitHub) with
  `AUTH_TOKEN_SECRET`; no Supabase Auth.
- **Local env files**: `.env` is **production**; `.env.staging` and
  `.env.dev` must be loaded explicitly (`architecture.md` → Local env files).
- The Room PDF needs the Docker image (WeasyPrint + Pango); it does not run
  on the product owner's Windows machine, so only CI and the image render
  PDFs.

## Completed Units

One line per unit, dates 2026, newest first. Spec files live in
`context/feature/`; details in the archives and in `architecture.md`.

"no mig." = no migration.

- **2026-11-23 Postgres pinned back to 17.6** (no mig.): a Dependabot bump to `postgres:18.7` broke the staging `db` (the 18+ image refuses the 17 data directory); pinned back, and Dependabot now ignores postgres major bumps.

### 2026-11-05 → 11-18

- **No 404 for a Document without a map** (11-18, no mig.): first read of
  the logs showed the API's only real 404s were `mention-map` and
  `linked-map` on every Document without one; both now answer `null` (200).
  The rest were scanners (`/.env*`, `/.git`, `/wp-*`), harmless.
- **CI in parallel shards** (11-18, PR #350, no mig.): frontend and backend
  tests each in four jobs; `Frontend coverage` / `Backend coverage` merge
  them and apply the 100% gates; `pip-audit` waits 60 s and retries once.
- **75, Monitoring** (11-17/18, PRs #339, #348, release #349, mig.
  `c6f1a9d3e7b2`): Beszel + Uptime Kuma on staging, agents + Dozzle on both
  servers behind a read-only Docker proxy (SSH tunnel only), email alerts,
  JSON logs, `/health/ready`, `/health/backup`, Admin page `/admin` for
  `ADMIN_USER_IDS`. Set up on both servers (`monitoring-guide.md`).
- **73, Leave Vercel and Supabase** (11-16 → 11-18, PRs #331, #334, #337,
  #342, #344, #346, #347; releases #333 → #351): step 1 frontend on the
  VPS, 2 staging on the Erith VPS, 3 own sign-in (mig. `b5e2c8f1a4d7`), 4
  images on Garage, 5 Postgres on the VPS + nightly backups +
  `restore-runbook.md`, 6 code cleanup (`vercel.json`, Supabase code,
  `CORS_ORIGIN_REGEX`, privacy notice in 12 languages). `own_object_path`
  still reads old Supabase links in exports.
- **74, Migrations from GitHub Actions** (11-16, PR #334, no mig.):
  `deploy/migrate.sh`, `db-migration` label, *Migrate database* button with
  the `migrate-production-approval` reviewer, CI reminder.
- **Docs-only merges skip the deploy** (11-17, PR #342): a deploy recreates
  the backend and briefly shows CORS errors in browsers.
- **View as: Players only, every Room page** (11-15, PR #332, no mig.).
- **License** (11-15, PR #330): GPL-3.0 → `FSL-1.1-ALv2` (each version
  becomes Apache-2.0 after two years), licensor Andrea Partenope.
- **72, Security hardening** (11-14, PRs #325, #327, release #329, no
  mig.): headers in the Caddyfile, CSP enforced (72_3), body caps, `/docs`
  off, per-user rate limits, `SECURITY.md`, CI security job. The PKCE idea
  for supabase-js is moot since 73 step 3.
- **Demo tour highlight beside the Document aside** (11-14, PR #328, no mig.).
- **Map split pane fits the screen** (11-13, PRs #322, #323, no mig.).
- **71, Relational link flag in import-export** (11-10, no mig.): JSON
  export schema 6.
- **69, Same-name Documents on import** (11-10, no mig.): Copy/Replace by
  name when the id matches nothing.
- **70, Master edits Players' answers** (11-12, PR #320, no mig.); Name
  question optional.
- **68, Relationship color legend** (11-09, PR #315, mig. `e7b3d9a1c5f2`):
  per-map meanings, legend, Room presets.
- **67, Adjustable relationship arc** (11-09, PR #314, mig. `d4a8f2c6b9e1`).
- **66, Back arrow navigation** (11-09, PR #313, no mig.): trail on every
  Room link, scroll restored.
- **65, Obsidian vault import** (11-08/09, PR #312, no mig.): zip/folder,
  pictures staged in the private bucket for the job only.
- **Rename a Room** (11-07, PRs #307-#310, no mig.).
- **64, Demo refresh** (11-05, no mig.): "Tokyo by Night", 25-step tour;
  every user-visible feature says whether the Demo needs it.
- **63, Clock out of the Session 0 tools** (11-05, no mig.).

### 2026-10-12 → 11-04

- **Clock dialogs** don't close on an outside click (11-04, no mig.).
- **62, 62b, 62c** curved map arrows, split pane from map cards (11-04, PR
  #301, no mig.). **Section blocks stay mounted** (11-03, PR #299).
  **pypdf 6.21.4** (11-03, PR #297).
- **61, Clocks** (11-03, PRs #293, #294, mig. `c1d7e3a9f5b2`).
- **60, Sections refinements and tools** (11-02/03, PRs #290, #291, mig.
  `e8c4a2f6b1d9`). **59, Large imports in image blocks** (PR #288, mig.
  `e9c4a2f7b1d8`). **58** map zoom in split view (PR #286). **57/57b/57c**
  UI consistency. **56** landing Sections in import-export (PR #284).
- **55, Room landing page** (10-31 → 11-02, PR #283, mig. `d5b8e1f3a9c7`).
  **54** poll choices as cards (mig. `c8f2d6a4e1b7`). **53** Session 0 polls
  (mig. `b9e4c2a7d1f3`). **52** live updates (SSE) for maps and comments.
- **51** Rooms page layout, **50** map places in the split pane, **49**
  larger text, **48** Markdown in Documents and Notes, **27b** PDF of one
  Document (10-28/29).
- **47, 47b, Modular Session 0** (10-28, migs. `e5c1a8f3b7d2`,
  `f3a9c1e7b5d4`, `a7d3f9b2c6e1`). **46, 46c, 46d, Session 0 boards** (10-27,
  migs. `4797859660e2`, `c3f8a1d6e9b4`, `d4a7e2c9f1b3`).
- Figma UI refactor (PR #252), docs aligned (`requirements.md` v0.6, PR
  #248), compact Room setup and Document form (10-26/27).
- **45** landing page, Demo, tour; **44** Room Index tab (mig.
  `b5f1d8e3a7c2`); **42** maps editable by players (mig. `e2b7c4f9a1d6`);
  **43** real-time map editing; Ex Libris rebrand (PR #228); maps on phones
  (10-22 → 10-25).
- **41** relational link Notes (mig. `a4d9e2c7f1b6`); **40** maps in
  duplication/export; **39** generate mentions; **38** geographic maps (mig.
  `d7c1f5a9e3b8`); **37** split view; **36** mention map (migs.
  `c6e2a9f4d8b3`, `e8b4d2f6a9c1`); **35** parchment PDF; **34** twelve UI
  languages; **33** Duplicate Room; **32** mention hover; **28**
  relationship maps (10-12 → 10-19).

### 2026-09-21 → 10-10

Specs 01 to 31: foundations, Documents and Comments, account and security,
localization, Room setup (to 09-30); Notes, Attachments, Characters,
Friends, Comments threads, mention backlinks, Reveal and View as, search,
Room export and PDF, version history, Room image, Document export/import,
image search, read aloud, GDPR (10-01 → 10-10). See the older archives.

## Next Up

- **76, Security hardening 2** (built 2026-11-18, PR #355 into staging):
  pinned builds from `uv.lock` + digests + `dependabot.yml`, Caddy access
  log with masked IPs, backup vault on staging (`backup-vault.sh`). After
  merge, product owner on the servers: vault first run + cron + monitor,
  then `BACKUP_KEEP_DAYS=7` on production (guide in
  `/mnt/project-files/vps/`). **Live 2026-11-18** (vault on staging, monitor
  green, `BACKUP_KEEP_DAYS=7` on prod). Follow-ups #356, #366: both backup
  scripts check `status/` is writable up front and replace
  `status/backup-last-ok` (Docker had made the folder, and a file in it, as
  root, which failed the runs at their last line). Left: confirm tonight's
  03:30 (prod) and 05:00 (vault) runs.
- **73, external clean-up** (product owner): delete both Supabase projects
  about mid-December 2026 after a last dump (and the `supabase-*.dump`
  files on the servers), remove the old OAuth redirect URLs at Google,
  Discord and GitHub, finish removing GitHub environments other than
  `vps-production`, `vps-staging`, `migrate-production-approval`; then drop
  Supabase from the privacy notice.
- **72, left**: turn on GitHub private vulnerability reporting.
- **46b, Dichiarazione d'Intenti invitation**: a Room's invitation opens its
  DDI read-only with "accept and join" (product owner, 2026-10-27). Ticket
  not written yet.
- **Two small tickets, not written yet**: default Tags in the creator's UI
  language (decided 2026-10-03), and a read-only members list for every
  member (the setup page stays Administrator-only).
- **On hold** (product owner, 2026-11-05): 31 GDPR follow-ups; UI audit
  tickets 57 follow-ups (re-align to the latest changes first).
- **38, Geographic maps, open follow-ups**: image search for the
  background, dragging link labels, dragging area names by hand (needs a
  migration), a Tag picking an area's color.
- **43, Real-time maps, not built**: presence, editing from a phone.
- **34, More UI languages, round two**: tr and zh-Hant, later.
- **Requirements not built** (`requirements.md` §14): Glossary entries
  (FR-N3/N4, VR-10), draft/published (FR-D6), notifications (FR-T9),
  sealed content (VR-09). The product owner decides whether they stay.
- **Parked**: Thread pagination (FR-T3), until Threads get long in practice.
- **Decisions taken while building, still to confirm**: "choices beyond
  the ticket" of specs 21 to 27 (2026-10-10 archive) and the proposed
  Decisions in later tickets.

## Open Questions

None. All open questions were closed with the product owner on 2026-10-03
(`requirements.md` v0.5); v0.6 (2026-10-27) brought the spec in line with
what was built since; v0.7 (2026-11-18, product owner's request) added
Session 0, Sections, Clocks, live updates, Markdown, the import extensions,
the map legend and self-hosting (D-46 to D-53). Log new spec gaps here.

## Architecture Decisions

Full reasoning lives in `architecture.md`; this is the index.

- Stack: React + Vite + TS, FastAPI, PostgreSQL 17, Garage (S3) for files,
  the backend's own OAuth sign-in, all self-hosted on OVH VPSes with Docker
  and Caddy (ticket 73; Supabase + Vercel until 2026-11-17). Mono-repo
  (`/frontend`, `/backend`, `/context`).
- The frontend never talks to Postgres or the bucket directly; visibility
  and ownership rules live only in `backend/app/domain/`. RLS with a deny
  policy stays as a safety net.
- Backend uses SQLAlchemy async + Alembic; no database FK to `users` for
  user ids (→ Backend Data Access).
- Images are proxied through the backend (validate → downscale → WebP →
  upload) rather than client-side signed uploads (→ Storage Model). Comment
  images are Document images linked by `document_images.post_id`, filtered
  per viewer by the Comment's visibility. Avatars reuse the pipeline with a
  square crop.
- Private bucket + 1-hour signed links, signed in one batch per response.
- Storage consistency via a `storage_cleanup` outbox + post-commit removal +
  background sweep, not in-request compensation.
- Favorite image is an `is_favorite` flag with a partial unique index;
  "exactly one while images exist" is application logic
  (`next_favorite_id`).
- "Main Tag" = a Tag with a non-NULL `tags.main_position`; the Glossary
  Index is a navigation over Tags, not the FR-N3/N4 Glossary entity.
- Localization: frontend and backend each have their own resource files with
  the same shape and share no code; domain exceptions carry keys, rendered
  at the API boundary.
- Live updates: one Server-Sent Events stream per Room per tab
  (`GET /rooms/{id}/events`), events sent only to members who may see the
  object; the Caddyfile routes the stream without compression.
- Migrations run from GitHub Actions on the server, inside the new backend
  image, so the database URL never leaves the server (ticket 74).
- Accepted limits: the signed-link cache and the storage sweeper are per
  backend process; a signed link already handed out works until it
  expires.
- A user's email is sent only to that user (NFR-03, 2026-10-03).

## Session Notes (lessons worth keeping)

- **Branch from `origin/staging`** (PRs target `staging`, see
  `code-standards.md`), or `git fetch` first: a branch cut from a stale
  local `main` once made merged files look reverted.
- **Re-check a PR's merge state** before pushing more commits to its branch
  after a gap (PR #19 was merged mid-session; follow-ups went out as #20).
- **A release PR that migrates needs the `db-migration` label before the
  deploy starts** (#349 got it just in time); otherwise run *Migrate
  database* by hand.
- Adding a `NOT NULL` column to a table that has rows needs a hand-added
  `server_default` (autogenerate omits it).
- Phosphor icons: use the `*Icon`-suffixed exports. Mantine v9 renamed
  `Grid`'s `gutter` to `gap`.
- Bash heredocs with backticks break; `Path.write_text` without
  `encoding='utf-8'` **truncates the file** on a non-cp1252 character (it
  emptied `ui-context.md` once). Always pass `encoding='utf-8'`. Prettier
  has no repo config: use `--single-quote --print-width 100`.
- Headless browser checks need a faked signed-in session (OAuth login
  can't be automated) and a stubbed API.
- `requirements.md` is the ID source for `D-`, `FR-`, `UC-`, `VR-`, `I-`,
  `OQ-`; it is protected, so spec gaps are logged under Open Questions
  rather than edited.
