# Progress Tracker

Update this file after every meaningful implementation change. Keep it
short: **one or two lines per unit**, with the *why* and anything a future
session must know. Ticket detail belongs in the ticket (`context/feature/`),
design detail in `architecture.md` / `ui-context.md`. When this file grows
past ~400 lines, move the old detail to a new archive file and condense.

Full history is archived; read it only when you need that detail:

- [`archive/progress-tracker-full-2026-11-04.md`](archive/progress-tracker-full-2026-11-04.md):
  the full log up to 2026-11-04 (specs 28 to 62: per-unit notes, every
  migration's apply history, Next Up as it stood).
- [`archive/progress-tracker-full-2026-10-10.md`](archive/progress-tracker-full-2026-10-10.md):
  up to 2026-10-10 (specs 12 to 31, browser walk-through checklist,
  "choices beyond the ticket" of specs 21 to 27).
- [`archive/progress-tracker-full-2026-09-30.md`](archive/progress-tracker-full-2026-09-30.md):
  the original log up to 2026-09-30 (specs 01 to 11).

## Current Status (2026-11-04)

- **Built**: features 01 to 62 (27b, 46b-d, 47b, 57b/c, 62b/c included);
  23c, 25 and 25b were dropped by the product owner. Latest: 62/62b/62c
  curved map arrows and split pane from map cards (PR #301), Section blocks
  kept mounted across saves (PR #299), pypdf security upgrade (PR #297),
  61 Clocks (PRs #293, #294).
- **Release state** (2026-11-04): `staging` and `main` match. PRs #288 to
  #301 (specs 59, 60, 61, 62, groups popover and Section blocks fixes,
  pypdf) reached `main` through release PRs #292, #298, #300 and #302; their
  migrations were applied to production beforehand. Dependabot PRs land on
  `main`: merge `main` into `staging` before opening a release PR.
- **Waiting on the product owner**: review of 55 (Room landing) and 57
  (UI consistency), now in production; 52 live updates to test with two browsers;
  legal review of `/privacy` and the DPAs with Supabase, OVHcloud and
  Vercel (spec 31; shipped before those were done). Keeping shared content
  anonymised after an account deletion is the default in place, not
  explicitly confirmed.
- **Test baseline**: backend and frontend both at 100% coverage with exact
  CI gates; `ruff`, `mypy`, `tsc`, lint and build clean.
- **Personal data rule**: any new table that stores a user id must be added
  to `account_repo.erase_personal_rows` (`architecture.md` → Personal data).

## Migrations and Releases

Alembic migrations are **not** applied on deploy: the product owner applies
them by hand (`alembic upgrade head` with the matching env file loaded,
`architecture.md` → Local env files and → Environments). Staging gets a
migration before its PR merges into `staging`; production gets it before the
release to `main` that ships it. Before any release, list what is pending
here and remind the product owner.

- **Head in the repository**: `c1d7e3a9f5b2` (Clocks, spec 61, PR #293).
- **Staging database**: `c1d7e3a9f5b2 (head)`, applied 2026-11-03 with
  `backend/.env.staging` loaded.
- **Production database**: `c1d7e3a9f5b2 (head)`, applied 2026-11-03 with
  `backend/.env` loaded (product owner's go-ahead), before the release that
  shipped it (PR #302). `e8c4a2f6b1d9` and `e9c4a2f7b1d8` were applied the same day.
- **Pending**: none on staging, none on production.

When a new migration lands, update the three lines above and add it to the
top of the chain below. Per-migration apply history (who, when, which env
file) up to 2026-11-04 is in the 2026-11-04 archive.

Chain, newest first (where each came from):
`c1d7e3a9f5b2` Clocks (61) ← `e9c4a2f7b1d8` import job progress (59) ←
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

Details in `architecture.md` → Environments and `vps-migration-plan.md` §12.

- **Production**: backend on an OVHcloud VPS (`api.exlibris.world`, Docker
  image from GHCR, deployed by `.github/workflows/deploy-prod.yml` after CI
  on `main`, Caddy for HTTPS; the Caddyfile is copied and reloaded by
  `deploy.sh`). Frontend on Vercel at `exlibris.world` /
  `www.exlibris.world`. Render production is suspended, kept for rollback.
  DB pool capped at 5 + 2 per process (`DB_POOL_SIZE`, `DB_MAX_OVERFLOW`)
  because Supabase's Session Pooler allows 15 clients.
- **Staging**: Render Docker service (`ttrpg-campaign-notes-2.onrender.com`)
  deployed from `staging` after CI, Vercel Preview of `staging`, its own
  Supabase project. `.env.dev` and `.env.staging` point at the same staging
  project.
- **Local env files**: `.env` is **production**; `.env.staging` and
  `.env.dev` must be loaded explicitly (`architecture.md` → Local env files).
- The Room PDF needs the Docker image (WeasyPrint + Pango); it does not run
  on the product owner's Windows machine, so only CI and the image render
  PDFs.

## Completed Units

One line per unit, dates 2026, newest first. Spec files live in
`context/feature/`; details in the archives and in `architecture.md`.
"no mig." = no migration.

### 2026-10-12 → 11-04

- **Clock dialogs** (11-04, no mig.): clock, group, rules, mark and history
  dialogs (and the rules delete-label confirm) no longer close on an outside
  click (`closeOnClickOutside={false}`, as in the Questions/Poll dialogs).

- **62, 62b, 62c** (11-04, PR #301, no mig.): free and mention map arrows
  drawn as curves (fanned when several, plain-line bundles as lanes); a map
  card's name opens the split pane; labeled "Anteprima" button in map
  headers. A draggable bend per arrow is left for a later ticket (migration).
- **Section blocks stay mounted across saves** (11-03, PR #299, no mig.):
  blocks keyed by `useBlockKeys`, so a folded block no longer reopens.
- **pypdf 6.21.4** (11-03, PR #297): Dependabot alerts #32-#38.
- **61, Clocks** (11-03, PRs #293, #294, mig. `c1d7e3a9f5b2`): progress
  clocks as Room content, per-Room rules, labels and mark kinds, groups
  (free, race, turn, sequence), Player proposals, Clocks page and Section
  block, live marks. Background in `61 - Clocks - background.md`.
- **60, Sections refinements and tools** (11-02 → 11-03, PRs #290, #291,
  mig. `e8c4a2f6b1d9`): Session 0 tool blocks in Sections, foldable blocks,
  in-place title/description, Documents page without the maps row. Tool
  blocks are not copied by Duplicate Room or the JSON export.
- **59, Large imports in image blocks** (11-02, PR #288, mig.
  `e9c4a2f7b1d8`): cap 2000 images, saved blocks of 25 with progress,
  restart resumes the image phase.
- **58, Map zoom kept in the split view** (11-02, PR #286, no mig.).
- **57, 57b, 57c, UI consistency** (11-02, no mig.): phone fixes, one
  palette, `PageHeading`, `SectionLoader`, `EmptyState`. Analysis in the
  Claude Doc "Ex Libris — Analisi coerenza UI/UX".
- **56, Landing Sections in import-export** (11-02, PR #284, no mig.):
  JSON export `schema_version` 4.
- **Groups popover fixes** (11-02, PR #289, no mig.).
- **55, Room landing page** (10-31 → 11-02, PR #283, mig. `d5b8e1f3a9c7`):
  `/rooms/:roomId` of Section cards, each Section a page of blocks, edited
  in place. Mockup: project files `landing-mockup/index.html`.
- **54, Poll choices as cards** (10-30, PR #280, mig. `c8f2d6a4e1b7`).
- **53, Session 0 polls** (10-30, PR #276, mig. `b9e4c2a7d1f3`).
- **Mention map page editing fix** (10-30, no mig.): uses
  `useBoardAutosave` and `useMapEvents` like free maps.
- **Document heading without kicker** (10-30, no mig.).
- **52, Live updates for maps and comments** (10-29/30, PR #274, no mig.):
  one SSE stream per Room per tab; 5 s polling only while it is down.
- **Document page on a phone; mention map buttons hotfix** (10-29, PRs
  #271, #273, no mig.).
- **51, Rooms page layout** (10-29, PR #269, no mig.).
- **50, Map places in the split pane** (10-28, PR #265, no mig.).
- **49, Larger text and icons** (10-28, PR #264, no mig.).
- **48, Markdown in Documents and Notes** (10-28, PR #262, no mig.):
  `architecture.md` / `ui-context.md` → Markdown text. Comments stay plain.
- **47, 47b, Modular Session 0** (10-28, PRs #259-#261, #263, migs.
  `e5c1a8f3b7d2`, `f3a9c1e7b5d4`, `a7d3f9b2c6e1`): chain of steps, Stars
  and Wishes, Questions → Documents, DDI with per-Player acceptance;
  separate sessions with "carry over".
- **27b, PDF of one Document** (10-28, PR #266, no mig.).
- **46, 46c, 46d, Session 0 boards** (10-27, PRs #249-#251, #254, #256,
  #257, migs. `4797859660e2`, `c3f8a1d6e9b4`, `d4a7e2c9f1b3`): Retro and
  Lines & Veils, SSE (the app's first), drag and drop.
- **Figma UI refactor** (10-27, PR #252, no mig.).
- **Docs aligned with the app** (10-27, PR #248): `requirements.md` v0.6.
- **Compact Room setup and Document form** (10-26, PRs #244, #245, no mig.).
- **45, Landing page, Demo, guided tour** (10-25, PRs #237, #240, #242,
  no mig.).
- **44, Room Index tab; maps row on the Room page; back arrow fixes;
  compact Note form** (10-25, PRs #235, #236, #241; mig. `b5f1d8e3a7c2`).
- **42, Maps editable by players** (10-24, PR #230, mig. `e2b7c4f9a1d6`).
- **43, Real-time map editing** (10-24, PR #229, no mig.): per-item PATCH
  saves. Push, presence, phone editing not built.
- **Ex Libris rebrand** (10-22, PR #228, no mig.): repo name, GHCR image,
  CORS URLs and `ttrpg.*` localStorage keys kept on purpose.
- **Maps on phones** (10-22, PR #227, no mig.).
- **41, Relational link Notes** (10-21, PR #222, mig. `a4d9e2c7f1b6`):
  only flagged Notes feed mention maps.
- **40, Maps in duplication and export/import; 39, Generate mentions; 38b
  geographic map reading mode** (10-19, PRs #215, #220, no mig.). Room PDF:
  a short Document stays in one column.
- **38, Geographic maps** (10-17, PR #210, mig. `d7c1f5a9e3b8`).
- **Room PDF fixes, spellcheck, hierarchical back, route code splitting**
  (10-15/16, no mig.).
- **37, Document preview and split view** (10-14 → 10-16, PR #190, no mig.).
- **36, Mention map** (10-14, PR #188, migs. `c6e2a9f4d8b3`,
  `e8b4d2f6a9c1` linked maps).
- **35, Parchment PDF style** (10-13, PR #180, no mig.).
- **34, Twelve UI languages** (10-12, PRs #168, #169, #173, no mig.): CJK
  PDF fonts must stay WOFF.
- **33, Room card menu and Duplicate Room** (10-12, PR #161, no mig.).
- **32, Mention hover preview** (10-12, PR #157, no mig.).
- **28, Relationship maps** (10-12 → 10-13, PR #159 and follow-ups, migs.
  `a8c4e2f6b1d3`, `b3f7d1e9c5a2`, `d5a1c8e3f2b7`, `a9e3c5d7b1f4`,
  `b4d8f2a6c1e7`).

### 2026-09-21 → 10-10

Specs 01 to 31: foundations, Documents and Comments, account and security,
localization, Room setup (to 09-30); Notes, Attachments, Characters,
Friends, Comments threads, mention backlinks, Reveal and View as, search,
Room export and PDF, version history, Room image, Document export/import,
image search, read aloud, GDPR (10-01 → 10-10). See the two older archives.

## Next Up

- **63, Clock out of the Session 0 tools** (ticket, 2026-11-04): the
  add-block popover groups Documenti / Mappe / Clock as Room content and
  puts the Session 0 tile and its tools under one "Sessione 0" heading.
  Frontend only, no migration. Awaiting the product owner's Q1-Q3.
- **46b, Dichiarazione d'Intenti invitation**: if a Room has a DDI, its
  invitation opens it read-only with "accept and join" (product owner,
  2026-10-27). Ticket not written yet (the DDI template itself is in 47_3).
- **62 follow-up**: a draggable bend per arrow (needs a migration).
- **Two small tickets, not written yet**: default Tags in the creator's UI
  language (decided 2026-10-03), and a read-only members list for every
  member (the setup page stays Administrator-only).
- **38, Geographic maps, open follow-ups**: image search for the
  background, dragging link labels, dragging area names by hand (needs a
  migration), a Tag picking an area's color.
- **43, Real-time maps, not built**: presence, editing from a phone.
- **45, Demo**: the sample Room has no images yet.
- **34, More UI languages, round two**: tr and zh-Hant, later.
- **Requirements not built** (`requirements.md` §14): Glossary entries
  (FR-N3/N4, VR-10), draft/published (FR-D6), notifications (FR-T9),
  sealed content (VR-09). The product owner decides whether they stay.
- **Parked**: Thread pagination (FR-T3), until Threads get long in practice.
- **Browser walk-through** (product owner): Notes (12), PDF Attachments
  (16), Characters (17), Friends (18), mention backlinks (20), search (21),
  version history drawer (24), Room export and PDF dialog at phone width
  (23), early card and modal UI (07, 13) were never seen running. Checklist
  in the 2026-10-10 archive under Next Up.
- **Ops, later**: delete the suspended Render production and old native
  staging services; backups and monitoring for the VPS
  (`vps-migration-plan.md` §7/§8; NFR-07).
- **Decisions taken while building, still to confirm**: "choices beyond
  the ticket" of specs 21 to 27 (2026-10-10 archive) and the proposed
  Decisions in later tickets.

## Open Questions

None. All open questions were closed with the product owner on 2026-10-03
(`requirements.md` v0.5); v0.6 (2026-10-27) brought the spec in line with
what was built since. Log new spec gaps here.

## Architecture Decisions

Full reasoning lives in `architecture.md`; this is the index.

- Stack: React + Vite + TS, FastAPI, Supabase (Postgres + Auth + Storage) —
  managed infra for a small team. Mono-repo (`/frontend`, `/backend`,
  `/context`).
- The frontend never talks to Postgres/Storage directly; visibility and
  ownership rules live only in `backend/app/domain/`. RLS is a safety net
  (deny-all for clients), not the primary mechanism.
- Backend uses SQLAlchemy async + Alembic, not Supabase's REST client; no FK
  to `auth.users` (→ Backend Data Access).
- Images are proxied through the backend (validate → downscale → WebP →
  upload with the secret key) rather than client-side signed uploads
  (→ Storage Model). Comment images are Document images linked by
  `document_images.post_id`, filtered per viewer by the Comment's
  visibility. Avatars reuse the pipeline with a square crop.
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
- Accepted limits: the signed-link cache and the Storage sweeper are per
  backend process; a signed link already handed out works until it
  expires.
- A user's email is sent only to that user (NFR-03, 2026-10-03).

## Session Notes (lessons worth keeping)

- **Branch from `origin/staging`** (PRs target `staging`, see
  `code-standards.md`), or `git fetch` first: a branch cut from a stale
  local `main` once made merged files look reverted.
- **Re-check a PR's merge state** before pushing more commits to its branch
  after a gap (PR #19 was merged mid-session; follow-ups went out as #20).
- Adding a `NOT NULL` column to a table that has rows needs a hand-added
  `server_default` (autogenerate omits it).
- Phosphor icons: use the `*Icon`-suffixed exports. Mantine v9 renamed
  `Grid`'s `gutter` to `gap`.
- Bash heredocs with backticks break; `Path.write_text` without
  `encoding='utf-8'` **truncates the file** on a non-cp1252 character (it
  emptied `ui-context.md` once). Always pass `encoding='utf-8'`. Prettier
  has no repo config: use `--single-quote --print-width 100`.
- Headless browser checks need a faked Supabase session (Google-only login
  can't be automated) and a stubbed API.
- `requirements.md` is the ID source for `D-`, `FR-`, `UC-`, `VR-`, `I-`,
  `OQ-`; it is protected, so spec gaps are logged under Open Questions
  rather than edited.
