# Progress Tracker

Update this file after every meaningful implementation change. Keep entries
short: a few lines per unit, with the *why* and anything a future session
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
