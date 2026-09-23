# Progress Tracker

Update this file after every meaningful implementation change.

## Current Phase

- **Setup + Auth unit complete** (2026-09-21).
- **Rooms + Membership unit complete** (2026-09-21).
- **Manage members/roles unit complete** (2026-09-21).
- **Documents unit complete** (2026-09-21, branch
  `feature/Gestione_membri_ruoli` — same branch as Manage members/roles,
  see Session Notes): CRUD, Tags, Ownership, and a real Visibility
  filter (Room/Master/Private/Selective) are done, backend and
  frontend, with automated tests and a headless regression check.
  **Details/Threads (D-18–D-20, FR-D3, FR-T1) were deliberately
  deferred**, as planned — this unit covers plain Document CRUD only.
  Also deferred: version history (FR-D5, Should), draft/published
  status (FR-D6, Could), cross-Document mentions/backlinks (FR-D4).
- **Document images unit complete** (2026-09-21, same branch; spec in
  `context/feature/01 - Add image to  Document.md`): multiple images
  per Document, from a local file or an image URL, stored in Supabase
  Storage after server-side validation + downscaling, shown on
  `DocumentDetailPage` in a carousel with a zoomable fullscreen viewer.
- **Document UI redefinition complete** (2026-09-21, same branch; spec
  in `context/feature/02 - redifine Document UI.md`): responsive,
  full-width Document detail card, emails instead of user ids, shared
  page/Document components.
- **Comments unit complete** (2026-09-21, same branch; spec in
  `context/feature/03 - Implementation of Comments`): the first slice of
  Threads (FR-T1, FR-T5, VR-03) — flat Comments on a Document with their
  own visibility, author-only editing, author/Master deletion with a
  placeholder, sort/filter toolbar, below the Document card. Replies,
  Details and pagination are not built yet (see Next Up).
- **Comments refactor complete** (2026-09-21, same branch; spec in
  `context/feature/04 - Refactor of Comments.md`): composer moved below
  the list, full-width bubbles, and images on Comments — stored as
  Document images (shown in the gallery) that inherit the Comment's
  visibility.
- **Code review 04 fixes complete** (2026-09-22, same branch; findings in
  `context/feature/04 codereview.md`): 10 of 11 review items fixed. These
  include DNS-rebinding-proof URL imports, Storage/DB consistency
  across failed transactions, and an atomic image limit. The docstring-coverage
  warning was deliberately not acted on (see Completed).
- **Account page complete** (2026-09-22, same branch; spec in
  `context/feature/05 - Account Page.md`, FR-A2): display name, avatar,
  pronouns and description on a new `/account` page reached from a
  circular avatar at the top right of every page; logout moved there.
  Users are shown by their display name everywhere, falling back to
  email. Backend committed separately (`dfbde1c`).
- **Google profile defaults complete** (2026-09-22, backend only): the
  Google name and picture are copied into the profile once, for
  whatever the user hasn't set.
- **Account page layout redefined** (2026-09-22, frontend only,
  uncommitted): the Account cards are now centered and full width like
  the Document page. New shared `PageCard` component (the full-width
  card style repeated by the Document, Comments and Account cards) now
  used by all three. From `md` up the avatar sits beside the form and
  the email beside sign-out; below `md` they stack. Build, lint and
  `npm test` 33/33 pass. Headless layout check at 1920/1280/900/375px:
  both cards centered (equal side margins), exactly as wide as the
  Document card, side-by-side from 992px, no horizontal overflow, zero
  console errors; screenshots checked by eye. Note: Mantine v9 renamed
  `Grid`'s `gutter` prop to `gap`.
- **Explicit deny policies complete** (2026-09-22, branch
  `fix/rls_explicit_deny_policies`, merged into `main` in PR #4): Supabase then flagged
  "RLS enabled, no policy" (info) on each table. Migration
  `f1c8a2e6d493` adds a restrictive `backend_only_deny_clients` policy
  (`FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)`)
  to all 15 `public` tables. It's idempotent, and its downgrade drops
  only these policies. **Applied to the live DB**, and exercised
  down/up. Nothing changes for the backend (table owner, not subject to
  RLS); the Data API still answers 42501. The dashboard's suggested SQL
  was *not* used: all its snippets were `to authenticated using (true)`,
  which grants read access instead of denying it. Guard test +2: every
  table has the deny policy (failed before, passes after), and no
  permissive policy targets the client roles (proven to catch that
  exact dashboard snippet, in a rolled-back transaction). Full suite
  **201/201**, mypy and ruff clean. `code-standards.md` now includes
  the SQL every table-creating migration must run.
- **Quick navigation (Document mentions) complete** (2026-09-22,
  frontend only, branch `feature/quick_navigation`;
  spec `context/feature/06 - Quick navigation.md`, first slice of
  FR-D4): typing `#` at the start of a word in a Document description or
  a Comment opens a list of the Room's Documents, filtered by name or
  Tag as you type; picking one (arrows + Enter/Tab, or click) writes
  `#Document name`, which is shown as an accent-colored link. Build,
  lint and `npm test` **63/63** pass; headless check 32/32. No backlinks
  yet (see Open Questions).
- **Quick navigation refinement complete** (2026-09-22, frontend only,
  same branch; spec `context/feature/06_1 - Quick
  navigation refnment.md`): Tags can be mentioned too (`#Tag` opens the
  Documents list filtered by that Tag, via a new URL-bound Tag filter),
  and when nothing matches the popup can create the typed name as a
  blank Document or a Tag, with a switch. Build, lint and `npm test`
  **84/84** pass; headless checks 32/32 (new) + 32/32 (regression).
- **Database lockdown complete** (2026-09-22, backend only): fixed
  Supabase's "RLS Disabled in Public" critical warnings. Every table
  was readable and writable through the Data API with the public key.
  All tables are now backend-only (RLS on, no client privileges), and a
  leftover sign-up trigger that would have broken new users was dropped.
- **Private image bucket complete** (2026-09-22, backend only): the
  `document-images` bucket is now private and every image URL is a
  1-hour signed link. Closes the "Document image privacy" open question.
- **Document card images + Tags complete** (2026-09-23, branch
  `feature/document_card_images_tags`; spec `context/feature/07 - Document
  visualizazion refactor_beckend.md`): a `DocumentCard` in the Documents list
  now shows the Document's Tags on their own line under the title and its
  images as a carousel at half the card's width, with the Owner line at the
  bottom. Adds the **favorite image** — the one that leads a Document, picked
  by an Owner with a heart on the image itself — as a real column with a
  partial unique index and a migration, and makes the Documents list read the
  whole page in a fixed number of queries instead of ~6 per Document.
  Backend and frontend committed separately. Backend **226/226** tests, mypy
  and ruff clean; frontend `npm run build`, `npm run lint` and `npm test`
  **88/88** pass. **Not visually verified in a browser** (see Session Notes).
- **Frontend test coverage unit complete** (2026-09-23): the frontend had
  88 tests, all of them pure-function tests over `src/lib`, and **no
  component or hook testing stack at all** — measured at 18% of statements.
  Added the stack (React Testing Library, jsdom, `@vitest/coverage-v8`, a
  `vitest.config.ts`, `src/test/{setup,utils,fixtures}.ts`) and **521 new
  tests**, covering every hook, every component, all 7 routed pages and the
  routing table. Now **609/609 pass** at **98.6% statements / 98.8% lines /
  93.2% branches / 98.4% functions**, with `src/lib` and `src/hooks` at
  100%, `src/components` at 97% and `src/pages` at 96%. Coverage floors are
  enforced in `vitest.config.ts`, so this can't erode silently. Conventions
  are written up in `code-standards.md` → Testing (frontend).
  No production code was changed by this unit.
- **CI complete** (2026-09-23): `.github/workflows/ci.yml`, the repo's first
  automated check, running on every PR and on pushes to `main`. Frontend:
  lint, build (type-check) and `npm run test:coverage`, gated by the
  thresholds in `vitest.config.ts`. Backend: ruff, mypy, and
  `pytest -m "not integration"` gated at 95% of `app/domain` (currently
  99%). **Needs no secrets**: the 90 tests that talk to the real Supabase
  project are deselected, marked automatically from their use of the
  `db_session` fixture, so CI never connects to the live database and fork
  PRs work. 138 backend tests run in CI in under a second. The trade-off is
  that **CI green does not mean the API layer was exercised** — running the
  full `pytest` locally is still a pre-merge step. See `architecture.md` →
  Continuous Integration.
- **Document card image orientation complete** (2026-09-23, frontend only,
  branch `feature/document_card_image_orientation`;
  spec `context/feature/07_1 - refinment.md`): a card image no longer gets
  cropped into a landscape box (`objectFit: cover` at a fixed height). Once an image loads, its natural
  size picks a **landscape** or **portrait** frame (new `imageOrientation` in
  `lib/images.ts`; square counts as landscape), shown with `objectFit:
  contain` so its aspect ratio is kept. The image column's cap rose from
  120/140px to 160/200px (`base`/`sm`) so a portrait image stays legible.
  Carousel slides are framed one by one. +7 tests (3 helper, 4 component),
  mutation-checked: forcing everything to landscape fails 3 of them. Build,
  lint and `npm test` **616/616** pass, coverage floors held. **Not
  visually verified in a browser** — same limitation as spec 07 (Next Up #0).
- **CORS for Vercel previews complete** (2026-09-23, backend only, branch
  `feature/cors_preview_origins`): optional `CORS_ORIGIN_REGEX` lets
  commit-preview deploys through, with a pattern that another Vercel account
  can't match. Needs the env var set on Render (see Completed).

## Current Goal

- None set yet for the next unit. Candidates (see Next Up): the rest of
  Threads (Details, nested replies with D-17) on top of the new `posts`
  table, or Visibility's remaining pieces (Reveal action + AuditLog,
  "view as User X").

## Completed

- Context/spec phase: `requirements.md`, `project-overview.md`,
  `architecture.md`, `ui-context.md`, `code-standards.md`,
  `ai-workflow-rules.md` written and reviewed.
- Repo scaffolding (Next Up #1, 2026-09-21):
  - Mono-repo initialized as a git repository at the project root.
  - `frontend/`: React + Vite + TypeScript, strict mode enabled explicitly
    (not on by default in the current Vite template). Mantine v9 wired up
    via `MantineProvider` (`forceColorScheme="dark"`) with a theme
    (`src/theme/theme.ts`) generated from the `ui-context.md` color/type/
    radius tokens, mirrored as CSS custom properties in
    `src/theme/tokens.css`. TanStack Query and React Router installed.
    Fonts (EB Garamond, Inter, JetBrains Mono) self-hosted via
    `@fontsource/*`. Phosphor Icons installed. Vite's default oxlint kept
    as the linter. Folder layout matches `code-standards.md`
    (`src/components/`, `src/hooks/`, `src/pages/`, `src/types/`).
    `npm run build` and `npm run lint` both pass. Placeholder `HomePage`
    proves the theme/build pipeline end to end (no real auth yet).
  - `backend/`: FastAPI + Python 3.14, folder layout matches
    `architecture.md` (`app/api/`, `app/domain/`, `app/db/`, `app/auth/`).
    `pyproject.toml` with strict mypy + ruff configured; both pass with
    zero issues. `pytest` set up with a passing smoke test against a
    `/health` route in `app/main.py`. `app/config.py` reads Supabase
    config from env via `pydantic-settings` (values still empty pending
    Supabase project creation). Virtualenv at `backend/.venv`.
  - Fixed a typo: an empty `beckend/` folder existed before this session;
    replaced with `backend/` per the user's confirmation.
  - `.env.example` added in both `frontend/` and `backend/` (no secrets
    committed); `.gitignore` added at root and in both codebases (later
    consolidated into a single root `.gitignore`, see below).
- Supabase project + Auth wiring (2026-09-21):
  - Supabase project created by the user (`mlksmacrcjurfuxtwdjw`), using
    the new publishable/secret API key system (not the legacy anon/
    service_role JWT keys). Real `VITE_SUPABASE_URL` /
    `VITE_SUPABASE_PUBLISHABLE_KEY` are in `frontend/.env` (gitignored,
    confirmed via `git check-ignore`). `backend/.env` only needs
    `SUPABASE_URL` (for the JWKS endpoint, see below) — the backend
    never uses the publishable key, so no field for it was added to
    `app/config.py`.
  - Confirmed via the project's live JWKS endpoint
    (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`) that this project
    signs JWTs with **ES256 asymmetric keys**, not a shared HS256
    secret — so `backend/app/config.py` has no JWT-secret field at all;
    `SUPABASE_JWT_SECRET` was dropped from both `.env.example` files.
  - Backend: `app/auth/jwt.py` verifies tokens via `PyJWKClient` against
    the JWKS endpoint (algorithm `ES256`, audience `authenticated`,
    issuer `{SUPABASE_URL}/auth/v1`); `app/auth/dependencies.py` exposes
    `get_current_user` / `CurrentUserDep` as a FastAPI dependency per
    `code-standards.md` ("never re-parse the token manually inside a
    handler"); `GET /auth/me` (`app/api/auth.py`) returns the resolved
    user. `tests/test_auth.py` verifies the whole flow (valid/missing/
    expired/wrong-audience tokens) by self-signing an ES256 token and
    monkeypatching the JWKS client — no live Google login needed for
    this test. mypy strict, ruff, and pytest (5/5) all pass.
  - Frontend: `@supabase/supabase-js` client in `src/lib/supabaseClient.ts`;
    `src/hooks/useSession.ts` tracks the Supabase session;
    `src/hooks/useCurrentUser.ts` (TanStack Query) calls the backend
    `/auth/me` through `src/lib/apiClient.ts`, which attaches the
    session's access token as a Bearer header — this is what proves the
    frontend session and backend verification agree on the same user.
    `HomePage` now has a real "Accedi con Google" button
    (`supabase.auth.signInWithOAuth({ provider: 'google' })`) and shows
    the backend-verified identity once signed in. `npm run build` and
    `npm run lint` pass.
  - Verified with a Playwright smoke test (headless Chromium, dev
    servers on 5173/8000) that the signed-out HomePage renders with no
    console errors, the correct dark background (`--bg-base`) and EB
    Garamond heading — confirms the theme/build pipeline, not the OAuth
    flow itself.
- Google provider verification (2026-09-21, later same day):
  - The user reported Google should already be enabled in Supabase.
    Confirmed via the public `GET {SUPABASE_URL}/auth/v1/settings`
    endpoint (`apikey` header only, no dashboard access needed):
    `"external":{"google":true,...}`.
  - Confirmed the OAuth chain is fully wired, not just the toggle: a
    direct `GET {SUPABASE_URL}/auth/v1/authorize?provider=google&
    redirect_to=http://localhost:5173` returns a 302 to
    `accounts.google.com` with a real `client_id`, the correct Supabase
    `redirect_uri` (`/auth/v1/callback`), and `localhost:5173` accepted
    as the post-login redirect (proves it's on the Auth "Redirect URLs"
    allowlist).
  - Clicked the actual "Accedi con Google" button via Playwright
    (headless Chromium) against the running frontend: it lands on
    Google's real sign-in page ("Sign in to continue to
    mlksmacrcjurfuxtwdjw.supabase.co"), no `invalid_client` or
    `redirect_uri_mismatch` error. This is as far as this can be
    verified without a real Google account completing the login by
    hand — that last click is on the user.
  - Consolidated `.gitignore`: merged the root, `frontend/`, and
    `backend/` `.gitignore` files into a single root `.gitignore` with
    path-scoped sections, at the user's request, to avoid three files
    drifting out of sync. Re-verified with `git check-ignore` that
    `.env`, `node_modules/`, `.venv/`, `dist/`, `__pycache__/`, and the
    mypy/ruff/pytest caches are all still excluded.
  - Dev servers were stopped after each check; nothing was left running.
- **Live login confirmed by the user (2026-09-21):** signed in with a
  real Google account (`andreapartenope@gmail.com`) on the running
  `HomePage`; Supabase issued a session and the backend's `GET
  /auth/me` verified the JWT and returned the matching `id`/`email`.
  Closes UC-01, FR-A1, FR-A2 and the Setup + Auth unit end to end.
- **Rooms + Membership backend (2026-09-21, branch
  `feature/rooms_and_membership`):**
  - **Backend Data Access decision**: direct Postgres access via
    SQLAlchemy 2.0 async (`asyncpg` driver) + Alembic, instead of
    Supabase's REST client — documented in `architecture.md` with the
    reasoning (atomic multi-table writes, e.g. Invariant 7's AuditLog
    requirement, aren't possible through PostgREST without pushing
    logic into Postgres functions). Connects through Supabase's
    **Session Pooler**, not Direct Connection — the direct host only
    has an IPv6 DNS record, unreachable from this network.
  - Schema (`backend/migrations/`): `rooms`, `memberships`, `tags`,
    `invitations` tables in `public`. User-referencing columns
    (`created_by`, `user_id`) deliberately have **no DB-level FK to
    `auth.users`** — that id always comes from a verified JWT, and a
    real FK broke integration tests using synthetic user ids (see
    `architecture.md`). Confirmed empty `public` schema before
    creating anything (the same Supabase project was previously used
    by an unrelated prototype, `TTRPG_Companion/`, on this machine).
  - Domain layer (`app/domain/rooms.py`, `app/domain/invitations.py`):
    pure, DB-free functions — `plan_new_room` (creator becomes
    Master + Administrator, 4 default Tags per D-14/FR-N1: NPC, Place,
    Event, Artifact, category "Type"), `plan_new_invitation`,
    `check_invitation_usable` (rejects revoked/expired), and
    `plan_accepted_membership` (rejects joining twice). Fully unit
    tested with no database involved (`tests/test_domain_*.py`).
  - API (`app/api/rooms.py`, `app/api/invitations.py`): `POST /rooms`,
    `GET /rooms` (mine, with role), `POST /rooms/{id}/invitations`
    (Administrator-only), `POST /invitations/{code}/accept`.
  - Integration tests (`tests/test_rooms_api.py`) run against the real
    Supabase DB, each wrapped in a savepoint that's rolled back after
    the test (`tests/conftest.py::db_session`) so nothing persists.
    Needed an async `httpx` client instead of the sync `TestClient`
    (mixing a sync-driven ASGI portal with an async DB connection from
    a different event loop broke asyncpg), and
    `asyncio_default_fixture_loop_scope = "session"` in `pyproject.toml`
    so the module-level DB engine survives across tests.
  - mypy strict, ruff, and pytest (21/21) all pass.
- **Rooms + Membership frontend (2026-09-21, branch
  `feature/rooms_and_membership`):**
  - `src/types/room.ts` (`Room`, `MyRoom`, `Invitation`) and
    `src/hooks/useRooms.ts` (TanStack Query: `useMyRooms`,
    `useCreateRoom`, `useCreateInvitation`, `useAcceptInvitation`),
    mapping the backend's snake_case JSON to camelCase domain types at
    the API boundary.
  - `src/lib/apiClient.ts`'s `apiFetch` extended with a `json` option
    (serializes body + sets `Content-Type`) to support POST mutations,
    used by all the hooks above.
  - Components: `RoleTag` (the app-specific badge `ui-context.md`
    calls out by name), `CreateRoomModal`, `InviteModal` (role picker
    plus a generated link with copy-to-clipboard), `RoomCard`.
  - Pages: `RoomsPage` ("my Rooms" grid and create action), replacing
    the old JSON-dump placeholder on `HomePage`; `AcceptInvitePage` at
    a new route `/invite/:code` that auto-accepts once signed in.
    Removed `useCurrentUser`/`types/auth.ts` (the Auth unit's debug
    dump), no longer used once `RoomsPage` became the real
    authenticated view.
  - `npm run build` (strict TS) and `npm run lint` pass; a Playwright
    regression check confirmed the signed-out screen still renders
    correctly with no console errors. The authenticated flow itself
    (create Room, generate/accept invite) couldn't be driven
    headlessly — no password-login path exists by design (Google-only,
    D-07) — so it was verified live by the user instead, who confirmed
    both Room creation and the invite-link flow work.
- **Branch mix-up caught and fixed (2026-09-21):** a new branch for
  this unit was created from a stale local `main` (missing the merged
  Rooms+Membership PR, `cd949b9`), which made several already-committed
  files look reverted on disk. Nothing was actually lost — both
  `feature/rooms_and_membership` commits were safely on `origin`. Fixed
  with `git reset --hard origin/main` (zero unique commits on the new
  branch, confirmed before running it) plus a fast-forward of local
  `main`. Lesson for future sessions: branch from `origin/main` (or
  `git fetch` first), not an unrefreshed local `main`.
- **Manage members/roles (UC-05) (2026-09-21, branch
  `feature/Gestione_membri_ruoli`):**
  - `app/domain/memberships.py`: pure functions `plan_role_change` and
    `plan_removal`, both funnelling through one `_ensure_successor_exists`
    guard for D-16/Invariant 5 — a Room can never lose its last Master
    or last Administrator. `plan_removal` covers both UC-05 (an
    Administrator removes someone) and UC-19 (a member leaves
    voluntarily), since the guard is identical either way; the caller
    passes `is_self` only to pick the AuditLog action name
    (`member_removed` vs `member_left`). 12 pure unit tests, no DB.
  - New tables: `users` (minimal mirror of `auth.users` — just `id` +
    `email`, upserted opportunistically when a user creates a Room or
    accepts an invite; see `architecture.md`) and `audit_log` (first
    real implementation of Invariant 7 — every role change and removal
    writes an entry in the same transaction as the change).
  - API: `GET /rooms/{id}/members` (any member), `PATCH
    /rooms/{id}/members/{user_id}` (role and/or admin flag, Administrator
    only), `DELETE /rooms/{id}/members/{user_id}` (Administrator for
    others, any member for themselves = leave). 6 integration tests
    against the real Supabase DB (rollback-wrapped, per
    `tests/conftest.py`).
  - Frontend: `RoomMembersPage` at `/rooms/:roomId/members` — a table
    with inline role `Select` / admin `Switch` for Administrators,
    read-only for everyone else, plus a leave/remove button; errors
    (e.g. the 409 from the D-16 guard) surface via
    `@mantine/notifications`. `apiClient.ts` gained JSON-`detail`
    parsing on error responses (so messages are human-readable, not raw
    JSON) and 204-No-Content handling (needed for `DELETE`). "Members"
    link added to `RoomCard`.
  - Along the way, discovered every bare Phosphor icon import
    (`Users`, `UserPlus`, `BookOpen`, `GoogleLogo`, `Plus`, `Check`,
    `Copy`, `ArrowLeft`, ...) is deprecated in the installed
    `@phosphor-icons/react` version in favor of an `*Icon`-suffixed
    export (`UsersIcon`, etc.) — fixed across the whole frontend, worth
    remembering for any new icon import.
  - mypy strict, ruff, and pytest (39/39) all pass; a Playwright
    regression check confirmed the signed-out screen and the new
    `/rooms/:id/members` route's signed-out guard both render with no
    console errors. The authenticated role/admin/remove UI itself
    wasn't clicked through live this time (same headless-Google-login
    limitation as before) — worth the user trying when convenient.
- **OQ-11 and OQ-12 resolved (2026-09-21):** formalized as
  `requirements.md` D-19 (who can add a Detail, how it behaves — Owner/
  Master edit rights, own visibility, nested replies, promotable) and
  D-20 (one Thread per Document, no others in v1), plus two new
  invariants I-10/I-11. Bumped `requirements.md` to v0.3 and fixed
  every stale cross-reference to the old OQ numbers in that file. This
  unblocked the Documents unit below with no requirements-level gap
  left.
- **Documents (FR-D1–D4, D-05, D-12, D-19, D-20 — Details/Threads
  deferred) (2026-09-21, branch `feature/Gestione_membri_ruoli`):**
  - `app/domain/documents.py`: pure functions — `plan_new_document`
    (creator becomes Owner), `is_owner`/`ensure_owner` (D-12: the
    Master is always an implicit Owner, same pattern as
    `app/domain/memberships.py`'s D-16 handling), `plan_add_owner`/
    `ensure_can_remove_owner` (no "last Owner" guard needed here,
    unlike Rooms — the Master's implicit Ownership means a Document can
    never end up ownerless), `can_create_document` (D-13/FR-D7: Master
    always can, a Player only if the Room hasn't disabled it).
  - `app/domain/visibility.py`: `is_document_visible` — the actual
    Invariant 1 filter (Room/Master/Private/Selective per section 8 of
    `requirements.md`), pure and DB-free, built now rather than bolted
    on later per the plan noted in this file's own Next Up from the
    prior session. Reused as-is by both the list and detail API routes.
  - New tables: `documents`, `document_tags`, `document_owners`,
    `document_visibility_grants`, plus `rooms.players_can_create_documents`
    (D-13/FR-D7, defaults `true`). The autogenerated migration for that
    last column had **no server default** for existing rows — would
    have failed against the Room already created during earlier live
    testing; fixed by hand-adding `server_default=sa.text('true')`
    before applying it (worth double-checking on every future
    `NOT NULL` column addition to a table that already has rows).
  - API (`app/api/documents.py`, `app/api/tags.py`): `POST/GET
    /rooms/{id}/documents`, `GET/PATCH /rooms/{id}/documents/{doc_id}`,
    `POST/DELETE /rooms/{id}/documents/{doc_id}/owners/{user_id}`,
    `GET/POST /rooms/{id}/tags`; also `GET/PATCH /rooms/{id}` (the
    latter for the D-13 toggle, Master-only). A Document a viewer can't
    see returns **404, not 403**, on both the list and detail routes —
    deliberate, so hidden content doesn't even reveal its own existence
    (VR-07). Tag name collisions are caught via a SAVEPOINT
    (`session.begin_nested()`) around the insert, not a plain
    try/except — a bare `IntegrityError` catch would have left the
    request's whole transaction aborted for every statement after it.
  - 20 new tests (12 pure domain — including a full Visibility truth
    table per level — plus 8 API integration): mypy strict, ruff, and
    pytest (70/70 total) all pass.
  - Frontend: `types/document.ts`, `types/tag.ts`,
    `hooks/useDocuments.ts`, `hooks/useTags.ts`; `VisibilityBadge` (the
    other app-specific component `ui-context.md` names, alongside
    `RoleTag`); `CreateDocumentModal` (with inline tag creation),
    `DocumentCard`, `RoomDocumentsPage` at `/rooms/:roomId/documents`
    (includes the Master-only D-13 toggle), `DocumentDetailPage` at
    `/rooms/:roomId/documents/:documentId` with inline editing for
    Owners and an Owner add/remove list. Split into a loader + a keyed
    `DocumentEditor` child component (state initialized directly from
    props, not via a `useEffect` sync) after oxlint's
    `set-state-in-effect` rule flagged the more obvious approach as a
    cascading-render risk.
  - `npm run build` (strict TS) and `npm run lint` pass; a Playwright
    regression check confirmed the signed-out screen and both new
    routes' signed-out guards render with no console errors. The
    authenticated CRUD/visibility/ownership UI wasn't clicked through
    live (same headless-Google-login limitation as every unit since
    Auth) — worth the user trying when convenient, especially the
    Visibility levels since those are new and security-relevant.
- **Document images (D-09, FR-D1) (2026-09-21, branch
  `feature/Gestione_membri_ruoli`, spec `context/feature/01 - Add image
  to  Document.md`):**
  - Picked up a half-finished, uncommitted single-image draft (one
    `documents.image_path` column + client upload via a Supabase signed
    upload URL). The feature spec asked for *several* images, URL
    imports and downscaling, so it was reshaped: migration
    `b051c9ffcdfe` (already applied, but no row used it) was downgraded
    and deleted, replaced by `ba03b9ea5f44` creating a `document_images`
    table (`id`, `document_id` FK cascade, `storage_path`, `created_by`,
    `created_at`; ordered by upload time).
  - **Upload model changed**: both sources now go through the backend
    instead of a client-side signed upload — see `architecture.md` →
    Storage Model for the reasoning (URL imports must be fetched/resized
    server-side anyway; one pipeline means the rules can't be bypassed).
    `app/domain/images.py::normalize_image` (pure, Pillow) validates the
    bytes are really PNG/JPEG/WebP/GIF, rejects >20 MB / >50 MP input,
    downscales to ≤1920px longest side, re-encodes to WebP q82 (strips
    EXIF/GPS; animated GIFs keep only their first frame).
    `app/domain/documents.py` adds `plan_new_image` / `ensure_can_add_image`
    (max 20 images per Document, random `{room}/{doc}/{uuid}.webp` path).
    `app/db/storage.py` does server-side upload/delete with the secret
    key; `app/db/remote_images.py` fetches URLs with an SSRF guard
    (http(s) only, public IPs only — re-checked per redirect, max 3 —
    10s timeout, 20 MB streaming cap).
  - API: `POST /rooms/{id}/documents/{doc}/images` (multipart `file`),
    `POST .../images/from-url` (`{url}`), `DELETE .../images/{image_id}`
    — all Owner/Master-only (D-12), behind the same visibility filter
    (404 for hidden Documents). `DocumentResponse.image_url` became
    `images: [{id, url}]` on every Document route. Errors: 409 over the
    image limit, 413 too large, 422 not an image / bad URL, 502 Storage
    down. If the DB insert fails after an upload, the object is removed
    again; a failed Storage delete rolls back the row delete.
  - Dependencies: `pillow`, `python-multipart` (backend);
    `@mantine/carousel`, `embla-carousel`, `embla-carousel-react`
    (frontend).
  - Tests: 7 pure image-normalization tests, 2 new domain tests, 8 SSRF
    guard cases, 9 API integration tests (Storage and URL fetch faked
    in-memory so rolled-back tests leave nothing in the real bucket).
    mypy strict, ruff, pytest **96/96** pass.
  - **Live Supabase check**: fetched a real 14.7 MB, 10109×4542 JPEG from
    Wikimedia through the SSRF-guarded fetcher, normalized it to a
    243 KB 1920×863 WebP, uploaded it to the real `document-images`
    bucket, read it back via its public URL (200, `image/webp`), then
    deleted it and confirmed via the Storage list API that the bucket is
    empty again. Note: the public URL kept answering 200 right after the
    delete — Supabase's CDN cache (see Open Questions).
  - Frontend: `types/document.ts` gains `DocumentImage`/`images`;
    `apiClient.ts` gains a `formData` option; `useDocuments.ts` gains
    `useUploadDocumentImages` (sequential, error names the failing file),
    `useImportDocumentImage`, `useDeleteDocumentImage`. New components:
    `DocumentImageGallery` (one image = plain hero, several = Mantine
    `Carousel` with loop + indicators; delete-with-confirm popover per
    image), `ImageViewerModal` (fullscreen, 100–500% zoom via buttons or
    double-click, scroll to pan, prev/next + "n / N" counter, zoom resets
    per image), `AddDocumentImages` (multi-file picker + URL field with
    http(s) validation). On `DocumentDetailPage` the gallery sits at the
    top of the card; add/delete controls appear only in edit mode (the
    pencil). Edit/cancel icons got `aria-label`s.
  - `npm run build` and `npm run lint` pass. Headless Playwright check
    with a faked session + stubbed API (Google-only login still can't be
    automated): carousel (3 slides, controls, indicators), viewer zoom
    (541×812 → 1082×1624 at 200%), prev/next, read-only mode shows no
    delete buttons, 2-file upload + URL import + delete all hit the right
    endpoints, single-image Document renders without a carousel, zero
    console errors. Separately confirmed the multipart request carries
    the full file bytes. Not yet clicked through live against the real
    backend by a signed-in user — worth doing.
- **Document UI redefinition (2026-09-21, branch
  `feature/Gestione_membri_ruoli`, spec `context/feature/02 - redifine
  Document UI.md`):**
  - **Owner/member shown as id — root cause was data, not UI**: the
    frontend already preferred `email`, but both real members
    (`andreapartenope@gmail.com`, `maxdump101@gmail.com`) had joined
    before the `users` mirror table existed, so `GET /rooms/{id}/members`
    returned `email: null` and the UI fell back to the raw id. Fixed by
    data migration `d3e8a1f4c2b7` (backfills `users` from `auth.users`
    for every Membership, only where the email is missing; applied and
    verified live — both members now resolve). The UI no longer ever
    falls back to an id: `lib/members.ts` (`memberDisplayName`,
    `displayNameFor`) renders "Utente sconosciuto" instead. Used on
    `DocumentDetailPage` (Owner badges + add-Owner picker),
    `RoomMembersPage`, and `RoomDocumentsPage`, whose `DocumentCard`s
    now also show an "Owner: …" line (the page previously showed no
    Owner at all, so this is new).
  - **Layout**: `DocumentDetailPage`'s card is now full width
    (`w="100%"`) inside a fluid container with responsive side margins
    (12/20/32px at base/sm/lg), dropping the old `maw={720}`. Card
    padding, title size and image gallery height (240/360/480px) scale
    with the viewport; long titles wrap instead of pushing the
    visibility badge off. Mantine `Group`'s default `preventGrowOverflow`
    was capping the header's children and truncating the badge on
    phones — disabled on those header groups, and `VisibilityBadge`
    itself no longer shrinks. The members table sits in a
    `Table.ScrollContainer` so it scrolls instead of overflowing on
    phones.
  - **Reusable pieces extracted** (spec: "as modular and reusable as
    possible"): `PageLayout` (fluid container + back link, used by all
    three pages), `PageState` (`FullPageLoader`, `FullPageMessage`,
    `SignInRequired` — replaced six copies of the same loading/sign-in
    markup), `TagList` (was duplicated in `DocumentCard` and the detail
    page), `DocumentOwners` (Owner badges + add/remove), `DocumentFields`
    (name/description/visibility/tags — now shared by
    `CreateDocumentModal` and the detail page's new `DocumentEditForm`,
    which also unified the two diverging visibility option lists), and
    `lib/notify.ts` (`notifyError`, was duplicated in two pages).
    `DocumentFormValues` type added to `types/document.ts`.
  - Small behavior change: in edit mode the name is now a labelled
    "Nome" field in the form (was an inline title input), and the edit
    form remounts each time editing starts, so Cancel no longer needs a
    manual reset. Save is disabled when the name is blank.
  - Checks: `npm run build` and `npm run lint` pass; backend mypy strict,
    ruff, and pytest **96/96** pass (no backend code changed besides the
    migration). Headless Playwright check (faked session, stubbed API)
    at 375/800/1600px on the detail, Documents list and members pages:
    no horizontal overflow at any width, detail card centered with
    symmetric margins, emails shown, no raw id anywhere in the page
    text, zero console errors; screenshots inspected by eye. Not yet
    clicked through live by a signed-in user.

- **Comments (FR-T1, FR-T5, VR-03, UC-11) (2026-09-21, branch
  `feature/Gestione_membri_ruoli`, spec `context/feature/03 -
  Implementation of Comments`):**
  - **Data model**: migration `2393196bb425` (applied to the live
    Supabase DB) adds `posts` (`id`, `document_id` FK cascade,
    `author_id`, `kind`, `body`, `visibility`, `created_at`,
    `updated_at`, `deleted_at`) and `post_visibility_grants`. Named
    `posts`, not `comments`, to match `requirements.md`'s Post model —
    Details will reuse it with `kind = 'detail'`. No `threads` table:
    one Thread per Document (D-20/I-11). Details in `architecture.md` →
    Storage Model.
  - **Domain** (`app/domain/comments.py`, pure): `plan_new_comment`
    (trimmed, non-empty, ≤10,000 chars), `plan_comment_edit` (author
    only; returns an AuditLog entry when visibility or the Selective
    grant list changes — Invariant 7/VR-08), `plan_comment_deletion`
    (author or Master; soft delete, body emptied — FR-T5 placeholder),
    `can_edit_comment`/`can_delete_comment`. `app/domain/visibility.py`
    was generalized: `is_content_visible` holds the section-8 levels,
    `is_document_visible` now delegates to it, and the new
    `is_comment_visible` uses it with the author as Owner (and the author
    always sees their own Comment).
  - **API** (`app/api/comments.py`): `GET/POST
    /rooms/{id}/documents/{doc}/comments`, `PATCH/DELETE .../{comment_id}`.
    Each response carries `can_edit`/`can_delete` for the requester.
    Hidden Document → 404 on all four routes; hidden Comment → 404 (VR-07);
    non-member → 403; Selective grantees must be Room members (422);
    editing/deleting a deleted Comment → 409. The shared membership +
    visible-Document checks moved out of `documents.py` into
    `app/api/access.py`, reused by both routers.
  - **Backend tests**: 24 pure domain tests (incl. a 10-row Comment
    visibility truth table) + 11 API integration tests (ordering,
    per-viewer Private/Selective/Master filtering, hidden Document,
    non-member, author-only edit — the Master gets 403 too, AuditLog row
    written on visibility change, Master moderation + placeholder,
    cross-Document id → 404). mypy strict, ruff and pytest **131/131**
    pass.
  - **Frontend**: `types/comment.ts`, `hooks/useComments.ts` (TanStack
    Query CRUD), `lib/comments.ts` (pure `applyCommentFilters` — sort
    newest/oldest/by author; filter by text, author, visibility, hide
    deleted — plus `commentAuthors`, `isEdited`, `hasActiveFilters`),
    `lib/time.ts` (Italian relative/absolute timestamps). Components in
    `components/comments/`: `CommentSection` (card below the Document
    card on `DocumentDetailPage`), `CommentComposer` (shared by "new" and
    inline edit; Ctrl/Cmd+Enter submits; Selective shows a member
    picker), `CommentToolbar`, `CommentItem` (Facebook-style bubble, see
    `ui-context.md`). New reusable pieces: `VisibilitySelect` (extracted
    from `DocumentFields`, now used by both Documents and Comments with
    subject-specific labels), `MemberMultiSelect`, `UserAvatar`;
    `VisibilityBadge` gained an optional `size`.
  - **Frontend tests**: added **vitest** (first frontend test runner,
    `npm test`); 13 unit tests for the sort/filter logic and timestamp
    formatting. `ai-workflow-rules.md`'s "before moving on" checklist now
    includes `npm test`.
  - Checks: `npm run build`, `npm run lint` and `npm test` (13/13) pass.
    Headless Playwright check (faked session, stateful stubbed Comments
    API) at 375px and 1400px: 23/23 checks pass — section below the
    Document card, default newest-first, oldest-first, author/search/
    visibility/hide-deleted filters, "n di m" counter, reset, posting a
    Selective Comment sends the right body/grants and clears the
    composer, inline edit sends PATCH, Master deletes another Player's
    Comment after confirmation, placeholder shown, empty state, no
    horizontal overflow, no raw user ids, zero console errors;
    screenshots checked visually. Not yet clicked through live by a
    signed-in user against the real backend.

- **Comments refactor (2026-09-21, branch `feature/Gestione_membri_ruoli`,
  spec `context/feature/04 - Refactor of Comments.md`):**
  - **Layout**: the composer moved from the top of the Comments card to
    the bottom, below the list (after a `Divider`; also below the empty
    state). Comment bubbles are now full width (`w="100%"`) instead of
    hugging their text.
  - **Images on Comments — data model**: migration `9e29c43313a1`
    (applied to the live Supabase DB; adds one nullable column, existing
    rows untouched) adds `document_images.post_id` → `posts.id`,
    `ON DELETE CASCADE`, indexed, FK named explicitly
    (`fk_document_images_post_id_posts` — the autogenerated `None` name
    would have broken the downgrade). A Comment image *is* a Document
    image, per the spec ("the images should be added to the Document
    images").
  - **Visibility decision (security-relevant)**: a Comment image inherits
    the Comment's visibility. Otherwise a Private/Selective/Master-only
    Comment's image would leak to everyone who sees the Document via its
    gallery. New pure `visible_document_images` in
    `app/domain/visibility.py`; every `DocumentResponse` is now built per
    viewer (list, detail, create, update, image and owner routes).
    Gallery delete by an Owner/Master only finds images they can see
    (404 otherwise).
  - **Rules** (`app/domain/comments.py`): `ensure_can_attach_image` /
    `ensure_can_detach_image` — author only, not on a deleted Comment,
    max `MAX_IMAGES_PER_COMMENT = 4` (also counts toward the Document's
    20). Deleting a Comment removes its images (rows + Storage objects,
    in the same transaction; a Storage failure rolls the delete back) so
    moderation actually removes the content.
  - **API**: `POST .../comments/{id}/images` (multipart),
    `POST .../comments/{id}/images/from-url`, `DELETE
    .../comments/{id}/images/{image_id}`; `CommentResponse` gains
    `images: [{id, url}]`. The image pipeline moved out of `documents.py`
    into `app/api/image_uploads.py` (shared by both routers — same
    validation, SSRF-guarded URL import, downscale/WebP, rollback);
    `documents.py` was rewritten around it with no behavior change for
    existing routes (all 131 prior tests still pass unchanged).
  - **Backend tests**: 6 new pure domain tests (attach/detach rules,
    per-Comment limit, `plan_new_image` link, gallery filtering incl.
    Selective grants, orphans and deleted Comments) + 8 API tests
    (attach → shows on Comment and in the gallery; only the author, the
    Master gets 403 too; 409 over the limit; Private Comment image hidden
    from another Player's gallery, list and delete; Comment deletion
    empties Storage and gallery; author detaches; Owner removes from the
    gallery; URL import). The in-memory Storage fake moved to
    `tests/conftest.py` (`fake_storage`) so both image test files share
    it. mypy strict, ruff, pytest **145/145** pass.
  - **Frontend**: `types/image.ts` (`StoredImage`, `PendingImage`);
    `lib/images.ts` (accepted types + `isHttpUrl` moved out of
    `AddDocumentImages`, pending-image helpers with object-URL cleanup,
    `remainingImageSlots`); `useComments.ts` replaces create/update hooks
    with one `useSaveComment` (save the Comment → remove images → upload
    new ones in order; an image failure is reported, not fatal, so a
    posted Comment is never lost or double-posted) and invalidates the
    Document too (gallery). New reusable components: `ImageThumbnailGrid`
    (view/remove/open), `ImageAttachButtons` (file + URL popover).
    `CommentComposer` stages images (also removal of existing ones when
    editing) and uploads them only on save; `CommentItem` shows
    thumbnails that open `ImageViewerModal`, and its delete confirmation
    warns that the images go too.
  - **Bug found and fixed during the check**: the URL popover's input
    used `autoFocus`, which focused it before the dropdown was
    positioned — whenever the composer was below the fold (i.e. almost
    always, now that it's at the bottom) the page jumped to the top and
    the popover closed. Now focused on `onOpen` with
    `preventScroll: true`.
  - **Frontend tests**: 6 new vitest tests (`lib/images.test.ts`); `npm
    test` 19/19, `npm run build` and `npm run lint` pass.
  - Headless Playwright check (faked session, stateful stubbed API incl.
    multipart/URL/delete image routes, real PNG bytes): **23/23** — composer
    below the list (and below the empty state), short bubble spans the
    full row, thumbnails load and open the viewer, Comment images appear
    in the gallery, file + URL staged and removable, POST Comment then
    multipart upload then URL import in that order, composer clears,
    4-image cap (picker trims, buttons disable), edit removes one image
    and adds another (PATCH + DELETE + upload), delete warning, sorting
    unaffected, no horizontal overflow at 375px, zero console errors;
    screenshots checked by eye. Not yet clicked through live by a
    signed-in user — worth trying an actual upload against the real
    bucket.

- **Code review 04 fixes (2026-09-22, branch `feature/Gestione_membri_ruoli`,
  findings `context/feature/04 codereview.md`):** each finding was checked
  against the current code first; all but the docstring warning were still
  valid.
  - **Duplicate relationship ids → 500**: `tag_ids` / `selective_user_ids`
    with repeats passed validation but hit the composite primary keys
    on insert. New shared request type `app/api/validation.py::UniqueIds`
    (Pydantic `AfterValidator`, dedupes, keeps order) on both Document
    create and update. Comments already deduped in the repo.
  - **User email wiped by a token without an email claim**:
    `users_repo.upsert_user` now does `COALESCE(excluded.email,
    users.email)`.
  - **SSRF via DNS rebinding** (was an Open Question): `remote_images.py`
    resolves each hop once, requires every address to be public, and pins
    the connection to the validated IP (original name in `Host` and as
    TLS SNI, so the certificate is still verified against it). Redirects
    are resolved against the original URL and pinned again.
    `fetch_image_bytes` gained an optional `transport` for tests.
  - **Storage/DB drift on failed transactions**: new `storage_cleanup`
    table (migration `5c1f7e2a9b30`, **applied to the live Supabase DB**;
    new table only, nothing existing touched) and
    `app/db/storage_cleanup.py`. An upload records a cleanup row in its own
    committed transaction before the object is uploaded, and the request
    clears it together with the image insert. A delete queues the objects
    and removes them only after commit (new `on_commit` hook in
    `app/db/session.py`). A lifespan sweeper (every 10 min, rows older
    than 15 min) removes orphans and retries failed removals. Behaviour
    change: deleting an image while Storage is down now returns 204 and
    the removal is retried later (it used to return 502 and roll back).
  - **Image limit race**: `ensure_room_for_another_image` now locks the
    Document row (`SELECT … FOR UPDATE`) before counting.
    `comments._attach_image` calls it before the per-Comment count, so
    both caps are counted under the same lock.
  - **Spec wording**: `context/feature/03 - Implementation of Comments.md`
    now says only the author edits a Comment. The Master can delete
    another user's Comment but not edit it, which matches the
    implementation.
  - **Frontend**: `CreateDocumentModal` blocks submit (button disabled,
    and guarded in `handleSubmit`) while a new tag is still being created.
    The Owner add/remove mutations now also invalidate the Documents
    list, so cards show new Owners. `RoomDocumentsPage` shows "Crea
    Documento" only to a Master, or to anyone when
    `playersCanCreateDocuments` is on. Owner/Selective pickers use the new
    `memberOptionLabel`, which adds 8 id characters to "Utente sconosciuto"
    so two members without an email can be told apart.
  - **Not done: docstring coverage** (CodeRabbit wants 80% of touched
    functions). Not a project standard: `code-standards.md` asks for
    comments where the reasoning isn't obvious, not a docstring on
    every function. Mass docstrings on thin handlers and repos would only
    restate the signatures. Revisit if the team adopts that threshold.
  - Tests: +1 dedupe API test, +1 email-preservation test, +3 SSRF
    pinning tests (mock transport + fake resolver, incl. a rebinding
    resolver and a redirect to a private host), +3 Storage-consistency
    tests (failed upload transaction swept later, failed Comment deletion
    leaves Storage intact, removal while Storage is down retried by the
    sweep), +3 vitest tests for `memberOptionLabel`. Backend mypy strict
    (app + tests), ruff, pytest **153/153**. Frontend build, lint, and
    `npm test` **22/22**.
  - Live checks: a pinned HTTPS fetch of a real Wikimedia image and an
    http→https redirect both succeed. `expired`, `self-signed` and
    `wrong.host` badssl.com certificates are all refused, which shows TLS is still
    verified against the original hostname. App lifespan started the
    sweeper against the live DB and shut down cleanly. The row lock was checked by
    its compiled SQL, not by a real two-connection race. The UI changes
    were checked by build/tests only, not clicked through.

- **Account page (2026-09-22, branch `feature/Gestione_membri_ruoli`,
  spec `context/feature/05 - Account Page.md`):**
  - **DB**: migration `7a4d2c9e1b58` adds nullable `display_name`,
    `pronouns`, `bio`, `avatar_path` to `users`. **Applied to the live
    Supabase DB** (new nullable columns only; nothing existing touched).
  - **Backend**: `app/domain/profiles.py` (normalization + length
    limits, `ProfileChanges` so only sent fields change and `null`/blank
    clears, `plan_avatar_path`); `normalize_image` gained
    `max_dimension` and `square` (center-crop) for 512px avatars;
    `users_repo` got `get_profile` (optionally `FOR UPDATE`) and
    `save_profile`; new `/account` router (GET, PATCH, POST `/avatar`,
    POST `/avatar/from-url`, DELETE `/avatar`); `app/api/profiles.py`
    (`ProfileFields`) shared by the account and members responses, so
    `MemberResponse` now also carries `display_name`, `pronouns`, `bio`,
    `avatar_url`. The image pipeline was split into reusable
    `normalize` + `upload_object` steps. `storage_cleanup` now treats
    `users.avatar_path` as a reference, so the sweep never removes an
    avatar in use.
  - **Frontend**: `types/profile.ts` (`UserIdentity` shared by
    `Member` and `AccountProfile`), `lib/profile.ts`, `hooks/useAccount.ts`
    (profile query, update, avatar upload/import/remove, `useSignOut`
    which also clears the query cache). Profile changes refresh every
    Room's member list. New components: `AppHeader`,
    `account/AccountButton`, `account/AccountSection`,
    `account/AvatarEditor`, `account/ProfileForm`, and
    `ImageUrlPopover` (extracted from `ImageAttachButtons`, now shared
    by it and the avatar editor). `UserAvatar` takes a `user` and
    shows the photo (circle) with an initials fallback. `lib/members.ts`
    names users by display name, then email; picker labels become
    "Name (email)". Comment search also matches the author's email.
    The members table shows avatar, pronouns and description; Owner
    badges and Comments show avatars. The old header email + "Esci"
    button is gone.
  - **Tests**: backend +25 (7 domain profile tests incl. a
    parametrized limit test, 3 square-crop tests, 13 Account API tests:
    auth, empty profile for a new user, edit, partial update/clear, too
    long → 422, names + avatars in the members list, 512px square
    avatar, replace removes the old object, remove, URL import, invalid
    file, the sweep keeps an avatar in use, a failed transaction's
    upload is swept). Backend mypy strict (app + tests), ruff, pytest
    **178/178**. Frontend +11 vitest tests (`lib/profile.test.ts`,
    `lib/members.test.ts` rewritten for display names, a comments test
    for chosen names): `npm test` **33/33**, `npm run build` and
    `npm run lint` pass.
  - **Headless Playwright check** (faked session, stateful stubbed
    API): **31/31** — avatar button top right and circular, old logout
    gone, Account page loads, save enabled only when dirty, PATCH body
    trimmed, initials switch from email to name, too-long name blocked
    client-side, reset, single-file picker, multipart upload, URL
    import, remove, no overflow at 375px, names/pronouns/description/
    avatars on the members page, Owner badges and Comments, sign out
    back to login, zero console errors. It caught two bugs, both fixed:
    a `Badge` nested in a `<p>` on the members page, and the form
    keeping the untrimmed input (instead of the saved value) as its
    baseline after saving. Screenshots checked by eye. **Not yet
    tried live** against the real bucket by a signed-in user.

- **Google profile defaults (2026-09-22, uncommitted):** decision (e) of
  the Account page. `CurrentUser` gained `google_name` /
  `google_picture_url` from the token's `user_metadata`; `/auth/me` now
  has an explicit response model so its shape (`id`, `email`) doesn't
  change. New `users.profile_prefilled_at` (migration `b2e6f1a8c4d9`,
  **applied to the live DB**, nullable column only). Domain:
  `plan_google_prefill` (only fills an unset name; cut to the limit
  rather than rejected) and `google_avatar_source` (asks Google for the
  512px size). `GET /account` runs the copy once, under the row lock;
  an unreachable picture is logged and skipped. Tests: +6 domain,
  +5 API (copied on first visit at 512px, copied only once even after
  the user clears both, never replaces what the user set, name still
  copied when the picture fails, shows in the members list). Not
  verified with a real Google token: the claim names follow Supabase's
  documented Google `user_metadata`.
- **Private image bucket (2026-09-22, uncommitted):** decision (d) of
  the Account page, applied to **all** images (user's choice).
  `storage.signed_urls` (batch signing, 1h links reused while ≥15 min
  remain, graceful when Storage is down) and `forget_signed_urls`
  (called when a removal is scheduled). Every response builder now
  signs once per response: `image_uploads.sign_images` /
  `image_responses`, `profiles.sign_avatars` / `profile_fields`;
  `list_documents` collects all visible images before signing. The
  live bucket was switched with `public: false` (size limit and MIME
  types kept). Checked live: signing real objects works and a missing
  path is left out; after the switch a fresh object's public URL is
  refused (400 "Bucket not found") while its signed link loads; an
  already-cached public URL still loaded from the CDN. Tests: +7
  (`test_storage_signing.py`: one request per batch, link reuse,
  renewal near expiry, outage leaves paths out, removed objects
  forgotten, API returns signed links, Documents still load when
  signing fails). Backend mypy strict, ruff, pytest **196/196**. No
  frontend change needed (URLs are opaque).

- **Database lockdown (2026-09-22, uncommitted):** Supabase flagged all
  15 `public` tables as "RLS Disabled in Public" (critical).
  - **Confirmed live before fixing**: every table granted `anon` and
    `authenticated` full privileges (Supabase's defaults for `public`),
    RLS off. With only the publishable key (which ships in the frontend
    bundle), the Data API returned rows from `rooms`, `documents`,
    `posts` and `users` (emails) without signing in. That bypassed every
    visibility rule (Invariant 1). Writes weren't tested, to avoid
    touching data, but the grants allowed them.
  - **Fix**: migration `c9d4e7b1f352` loops over every `public` table:
    RLS on, no policies, `REVOKE ALL` from `anon`/`authenticated`; also
    sequences, and `postgres`'s default privileges for future
    tables/sequences/functions. Its downgrade is a deliberate no-op (it
    would re-expose everything). **Applied to the live DB.** The
    backend connects as `postgres`, the table owner, so it isn't
    subject to RLS and nothing else changed.
  - **Verified**: the Data API now answers 42501 "permission denied"
    for every table; full suite **199/199**. New guard
    `tests/test_database_security.py` (3 tests: RLS on everywhere, no
    client grants, no client default privileges) failed before the fix
    and passes after. The grant check was separately proven to catch
    an injected grant (in a rolled-back transaction).
  - **Also found and removed**: trigger `on_auth_user_created` on
    `auth.users` + `public.handle_new_user()` (`SECURITY DEFINER`),
    created outside our migrations (apparently a Supabase quickstart).
    It inserted into `public.profiles`, which doesn't exist, so a new
    user's first sign-in would most likely have failed. Dropped by
    migration `e5a3b8d2c671` (user's decision); its downgrade restores
    it exactly. **Applied to the live DB.** New-user sign-up hasn't been
    re-tested live yet.
  - Storage was already fine: `storage.objects` has RLS on and no
    policies, so only the backend's secret key reaches the (now
    private) bucket.
  - New convention in `code-standards.md`: every table-creating
    migration must enable RLS.

- **Quick navigation — Document mentions (2026-09-22, frontend only,
  branch `feature/quick_navigation`, spec
  `context/feature/06 - Quick navigation.md`, first slice of FR-D4):**
  - **Storage decision**: a mention is plain text, `#Document name`, as
    the spec says. Nothing is stored server-side and no backend changed.
    Mentions are resolved when rendered, against the Room's Document
    list, which the backend already filters per viewer. So a mention of
    a Document you can't see stays plain text and reveals nothing
    (VR-07). Resolution: a `#` at the start of a word (or after `(`,
    `[`, `{`), longest matching name wins, case-insensitive, and it
    must end on a word boundary (`#Rome` doesn't match `#Romeo`).
    Written up in `architecture.md` → Storage Model → Document mentions.
  - **Pure logic** (`lib/documentMentions.ts`): `findMentionQuery`
    (the `#…` being typed at the caret; names can contain spaces, so
    the query can too), `filterMentionCandidates` (name prefix, then
    word prefix, then substring, then Tag matches; accent- and
    case-insensitive; max 8), `insertMention`, `splitMentions`,
    `mentionKeyAction`, `moveActiveIndex`.
  - **Reusable components** (`components/mentions/`):
    `DocumentMentionsProvider` (context with the Room's Documents and
    Tags, same TanStack queries as the pages, so no extra requests;
    context in `hooks/useDocumentMentions.ts`), `MentionTextarea`
    (drop-in for Mantine's `Textarea`: Popover list with name + Tags,
    arrows, Enter/Tab, click, Esc; ARIA combobox/listbox with
    `aria-activedescendant`; Ctrl/Cmd+Enter still reaches the Comment
    composer; the list stays open past a space only while something
    matches) and `MentionText` (renders mentions as `--accent-primary`
    links; `linked={false}` for places that are already links). Both
    fall back to plain behavior without a provider.
  - **Wired in**: `DocumentFields` description (so both the create
    modal and the inline editor get it, with a hint line "Scrivi # per
    collegare un altro Documento."), `CommentComposer` (new and edit;
    placeholder mentions `#`), `DocumentDetailPage` description,
    `CommentItem` body, `DocumentCard` description (colored only, since
    the card is a link). Providers on `DocumentDetailPage` and
    `RoomDocumentsPage`.
  - **Tests**: 30 new vitest tests (`lib/documentMentions.test.ts`):
    query detection, filtering and ranking (incl. Tag search, accents,
    limit), insertion, parsing (spaces in names, longest match, word
    boundary, punctuation, mid-word `#`, hidden Documents, adjacent
    mentions), key mapping and wrap-around. `npm test` **63/63**, `npm
    run build` and `npm run lint` pass. No component tests: the project
    has no DOM test setup (testing-library/jsdom), so the UI is covered
    by the headless check below.
  - **Headless Playwright check** (faked session, stateful stubbed
    API): **32/32**. Covered: links and their targets on the Document
    and on Comments; unknown and mid-word `#` left plain; accent color;
    bare `#` lists everything; filtering while typing; Tags shown; Enter,
    Tab and click insert and put the caret after the mention; Tag
    search; arrow highlight wraps and `aria-activedescendant` follows;
    focus stays in the textarea after a click; "Nessun Documento
    trovato"; Esc closes and Enter is a newline again; Ctrl+Enter posts
    with the list open; the posted Comment renders its links; the
    description editor's PATCH carries the mention; clicking a mention
    opens the Document; cards show colored mentions with no nested
    links; works in the create modal; at 375px no overflow and the list
    fits (it flips above the field). Zero console errors; screenshots
    checked by eye. Two issues found and fixed: Mantine's `Anchor` uses
    a lighter accent shade in dark mode (now pinned to
    `--accent-primary`), and the Popover's fade made the list
    half-transparent while typing (transition removed, like Mantine's
    Combobox). Not yet tried live by a signed-in user.

- **Quick navigation refinement (2026-09-22, frontend only, branch
  `feature/quick_navigation`, spec
  `context/feature/06_1 - Quick navigation refnment.md`):**
  - **Tag mentions**: the popup now lists Tags as well as Documents
    (`MentionTarget` union: a Document with its Tags, or a Tag with how
    many visible Documents carry it). Ranking: name prefix, word prefix,
    substring, then Documents matched only through a Tag; a Document
    comes before a Tag on a tie. Picking a Tag writes `#Tag`.
    `splitMentions` resolves Tags too (Document wins a same-name tie),
    and `MentionText` links a Tag mention to
    `/rooms/{id}/documents?tag={tagId}` (`mentionHref`,
    `documentsWithTagsHref`).
  - **Documents list filtered by Tag**: `RoomDocumentsPage` reads
    `?tag=` (repeatable, AND; `lib/documentFilters.ts::filterDocumentsByTags`)
    and shows a new reusable `TagFilter` (URL-bound `MultiSelect`), plus
    "Nessun Documento con questo Tag." / "Mostra tutti" when empty. Also
    a first slice of FR-N2 (filter by one or more Tags).
  - **Create from the popup**: when nothing matches, a create row offers
    the typed name as a **blank Document** (only `name`, so Room
    visibility — the user's choice; see Open Questions) or a **Tag**,
    with a Documento/Tag switch. Only what the backend would allow is
    offered (`lib/roomPermissions.ts`: `canCreateDocuments` — D-13;
    `canManageTags` — Master or Administrator); nothing allowed = just
    "Nessun risultato". A plain Enter never creates (reach the row with
    ↓, ←/→ switch kind, Enter creates), so typing `#word` + newline
    doesn't create anything by accident. After the request succeeds the
    `#query` is replaced with `#Name` only if it's still unchanged in the
    text; errors show a notification. `DocumentMentionsProvider` now
    takes `currentUserId` and exposes `canCreateDocument`,
    `canCreateTag` and `create()`.
  - **Popup behavior changes**: it stays open past a space while
    something matches *or can be created* (so multi-word names can be
    created), but never while writing prose after a finished mention
    (`isFinishedMention`). Esc or a pick closes it for that `#` until the
    caret leaves the mention (was: until the query changed).
    `mentionKeyAction` now takes the popup state (list / create row /
    highlighted). The popup content moved to `MentionSuggestions.tsx`.
    `RoomDocumentsPage` reuses `canCreateDocuments` instead of its
    inline rule.
  - **Bug found in the check and fixed**: the kind switch was first a
    Mantine `SegmentedControl`. Clicking it moved the focus to its hidden
    radio input, which blurred the textarea and closed the popup. It is
    now two plain buttons (`aria-pressed`), which don't take the focus.
  - **Tests**: vitest **84/84** (+21): Tag candidates and counts,
    Document-before-Tag ordering, Tag mentions in `splitMentions`, links,
    `isFinishedMention`, creatable kinds, name cleanup, the new key
    states (plain Enter never creates), `roomPermissions`,
    `filterDocumentsByTags`. `npm run build` and `npm run lint` pass.
  - **Headless Playwright check** (faked session, stateful stubbed API):
    new script **32/32**. It covers the Tag mention link and its color,
    the Tag listed first with its count, Enter inserting `#NPC`, and no
    popup while writing after a mention. For creation it covers: the
    create row for a multi-word name, the switch by mouse (focus stays in
    the textarea), and that a plain Enter doesn't create. A click creates
    a Document whose POST body is only `{name}`, and the mention is
    inserted with the focus kept. ↓ highlights the row (and sets
    `aria-activedescendant`), → switches to Tag, and Enter creates it.
    The posted Comment links the Tag, the new Document and the new Tag.
    A Tag link opens the filtered list with the Tag selected; clearing
    the filter works, and so do the empty message and "Mostra tutti". A
    Player without rights gets no create row, and a Player who may only
    create Documents gets no switch. At 375px it fits with no overflow,
    and there are zero console errors. The previous script was updated
    for Tags appearing in the list and passes **32/32**. Screenshots
    checked by eye. Not yet tried live by a signed-in user.

- Document card images + Tags (spec `07 - Document visualizazion
  refactor_beckend.md`, 2026-09-23, branch
  `feature/document_card_images_tags`):
  - **Favorite image** (backend, commit `a4538f1`): migration
    `a4f7b2c8e015` adds `document_images.is_favorite` plus the partial
    unique index `uq_document_images_one_favorite`
    (`document_id WHERE is_favorite`), so "only one per Document" is the
    database's rule and two concurrent PUTs can't both win. The rules are
    in `app/domain/documents.py` — `plan_new_image` gives the flag to the
    first image added, `next_favorite_id` hands it to the oldest survivor
    when the favorite is removed (applied in `image_uploads.py::remove_images`),
    so a Document that has images always has exactly one favorite. New route
    `PUT /rooms/{room}/documents/{doc}/images/{image}/favorite`,
    Owner/Master only (D-12), restricted to an image the requester can
    already see — otherwise it would answer "does this id exist?" about a
    Private Comment's attachment (VR-07). The migration backfills existing
    Documents with their oldest image. Applied to the live DB.
  - **Favorite writes are serialized by the Document's lock** (review
    follow-up, 2026-09-23): setting the favorite and removing images now take
    `lock_document` like the upload paths already did. Two concurrent
    `PUT .../favorite` calls would otherwise both clear and both set — the
    second one's clear matches nothing, so its `true` hits the partial unique
    index and the request 500s. Worse, a concurrent delete of the image
    another request was about to promote left the Document with images and
    **no favorite**, silently; the index only forbids a second `true`, so it
    cannot catch that. `remove_images` locks every affected Document, not only
    those losing their favorite — deleting a non-favorite image is exactly
    what invalidates the other request's successor — in sorted id order. The
    favorite route locks *before* reading the visible images, so the
    check-then-set is atomic. A second pass (same day) closed what that left:
    `remove_images` still *decided* whether to promote from the
    `is_favorite` on its passed-in images, which were read before the lock —
    a concurrent move of the favorite onto an image being deleted made them
    say "not the favorite" and the promotion was skipped. It now decides from
    a fresh read under the lock, and asks every affected Document to restore
    the invariant rather than only those thought to have lost their favorite:
    `next_favorite_id` already answers exactly that and returns None when
    there's nothing to do. No concurrency test: the suite's savepoint
    fixture gives each test a single session, so there's no pattern here for
    driving two real connections.
  - **Gallery order**: `is_favorite DESC, created_at, id`, set once in
    `documents_repo`, so the card and the detail page never disagree about
    which image is first. A Comment attachment may be the favorite; it stays
    visibility-filtered, so a viewer who can't read that Comment just gets
    the next image leading their card.
  - **Batched Documents list** (same commit): `GET /rooms/{id}/documents`
    cost ~6 queries per Document (owners, grants, tags, images, and two more
    for the Comment-visibility filter) — acceptable when a card was a title,
    not now that every card renders its gallery. It reads owners and grants
    for the Room in one query each, applies the visibility filter, then reads
    tags and images only for what survived (`documents_repo.*_for_documents`,
    `api/access.py::get_visible_images_for_documents`). The batched image path
    reuses the same `visible_document_images` filter, and a test pins that a
    Private Comment's attachment never reaches another member's list response
    (Invariant 1). `_build_response` no longer queries, so it's sync now.
  - **Card layout** (frontend): Title block (name + `VisibilityBadge`, Tags
    below), then description and images side by side at half width each, then
    the Owner line. New `DocumentCardImages` — the detail page's carousel,
    read-only and short, drag off, arrows always visible. The card's link is
    now an absolutely positioned overlay rather than a wrapper, because an
    `<a>` may not contain the carousel's buttons; those sit above it.
  - **Heart control**: `DocumentImageGallery` takes an optional
    `onSetFavorite`, shown as a heart at the bottom right of each image
    (opposite the delete button). No confirmation — it's reversible — and
    gated on being an Owner, not on edit mode.
  - **One image mapper**: `RawImage` (wire shape) + `lib/images.ts::toStoredImage`
    replace the per-hook `{ id, url }` mapping. `useComments` had typed its
    raw images as the camelCase `StoredImage`, which only worked while the
    two shapes matched; adding `is_favorite` would have broken it silently.
    `leadImage` picks the image a card leads with, falling back to the first
    visible one when the favorite was filtered out for that viewer.
- **CORS for Vercel previews (2026-09-23, backend only, branch
  `feature/cors_preview_origins`):** preview deploys failed their preflight
  (`OPTIONS /account`) because each one gets a generated hostname that isn't
  in `CORS_ORIGINS`.
  - New optional setting `cors_origin_regex` (env `CORS_ORIGIN_REGEX`),
    passed to Starlette's `allow_origin_regex` next to the unchanged exact
    list. A blank value means unset; a pattern that doesn't compile fails at
    startup and names the env var. The middleware setup moved into
    `app/main.py::add_cors` so tests wire a throwaway app exactly like the
    real one.
  - **Pattern choice**: `https://ttrpg-campaign-notes-[a-z0-9]+-rum11\.vercel\.app`.
    The version first suggested (`[a-z0-9-]+`) also matches another Vercel
    account whose scope ends in `-rum11`
    (`…-abc123-evil-rum11.vercel.app`), so hyphens are excluded, which also
    excludes branch-alias previews (`…-git-<branch>-rum11`). Reasoning in
    `architecture.md` → Auth and Access Model.
  - `tests/test_cors.py`: real preflights against the pattern (commit
    previews and production allowed; the look-alike, branch alias, prefix,
    suffix, `http` and unescaped-dot variants rejected; no pattern = exact
    list only) and config parsing (default, blank, trimmed, invalid).
    +16 tests; backend ruff, mypy strict, pytest non-integration **154/154**.
  - **Deploy step, not done from here**: set `CORS_ORIGIN_REGEX` to the
    pattern above in Render's Environment tab and redeploy; until then
    previews stay blocked. Check with
    `curl -i -X OPTIONS https://ttrpg-campaign-notes.onrender.com/account -H "Origin: https://ttrpg-campaign-notes-<hash>-rum11.vercel.app" -H "Access-Control-Request-Method: GET"`,
    which should return `access-control-allow-origin` with that origin.

## In Progress

- None yet.

## Next Up

0. **Verify the new Document card in a browser** — the layout below `sm`
   (where a half-width image column is tightest), that the carousel arrows
   really do beat the card's link overlay, that clicking an image still
   opens the Document, and (spec 07.1) that portrait and landscape images
   look right side by side with the description. Built and type-checked,
   not seen running; the repo has no committed headless-check tooling, so this needs a session with the
   app up (see Session Notes).
1. Mention backlinks (rest of FR-D4): store mentions server-side on
   save, show "Mentioned in" on the Document page (filtered per viewer),
   and decide whether mentions should survive a rename.
2. Rest of Threads on top of the new `posts` table: nested replies
   (FR-T1/T2) with D-17/VR-04's "never wider than the parent" check in
   the domain layer (Invariant 3), and pagination (FR-T3) if Comment
   counts grow. Comments are currently flat and loaded all at once.
3. Details/Threads (D-18, D-19, D-20, FR-D3, FR-T1, FR-T5–T7): the
   deferred half of the Documents unit — titled top-level Posts in a
   Document's one main Thread, own visibility per Post (VR-03, reusing
   `app/domain/visibility.py`'s pattern), edit rights limited to the
   author and Master (D-19/I-10), nested replies with D-17/VR-04's
   "never wider than the parent" constraint (not yet built — this is
   the first unit that needs it). FR-T6–T9 (mentions, reactions,
   pinning, resolving, notifications) are Should/Could priority —
   worth scoping down to FR-T1/T5/T10 (post, edit/moderate, show
   Details on the Document card) for a first slice, same "thinnest
   usable" approach as before.
4. Reveal action + fuller Visibility (VR-02, VR-05, VR-06, FR-V2, FR-V3,
   FR-V5): default visibility per Room, the Reveal action with
   AuditLog + notification, "view as User X" for the Master. The
   Visibility *filter* exists now (Documents unit); Reveal and the
   rest of the VR- rules don't yet.

## Open Questions

- OQ-09 · OQ-10 from `requirements.md` (section 6) are formally
  unresolved (no `D-` number assigned) but now fully implemented in
  practice: creator = Administrator + Master on creation (OQ-09), and
  the last-Administrator/last-Master successor requirement (OQ-10/D-16)
  is enforced by the Manage members/roles unit above.
- OQ-11 and OQ-12 are resolved (see Completed, 2026-09-21) — no open
  requirements-level question blocks Details/Threads (Next Up #1)
  anymore.
- ~~Document image privacy~~ — resolved 2026-09-22: private bucket +
  1-hour signed links (see Completed). Remaining, by design: a link
  already handed out works until it expires. Old public URLs may be
  served from the CDN cache for a while after the switch.
- **Signed-link cache is in-process (new, 2026-09-22)**: each backend
  process keeps its own cache, so several workers each sign (harmless,
  only fewer cache hits). Worth a shared cache only if signing load
  ever matters.
- **Spec gaps from the images feature (new, 2026-09-21)**:
  `requirements.md` D-09/FR-D1 still say "Immagine" (singular); the
  feature spec asks for several. Not edited (protected file), so it
  should be updated in a product pass. The 20-images-per-Document cap
  and the 1920px/WebP output are implementation choices, not spec'd,
  so change them if they don't fit.
- **Comments: implementation choices to confirm (new, 2026-09-21)**:
  (a) the author always sees their own Comment, so "Solo Master" on a
  Player's Comment means "me + the Master" (same as Private) — section 8
  literally says "only Masters"; (b) the Master can delete but **not
  edit** others' Comments (FR-T5 "moderate" read as delete, per the
  section 9 matrix); (c) moderation deletes are not written to the
  AuditLog (Invariant 7 doesn't list them); (d) 10,000-char body limit.
  None of these is in `requirements.md` (protected), so they need a
  product decision if any should change.
- **Comment images: choices to confirm (new, 2026-09-21)**: (a) a
  Comment image inherits the Comment's visibility, including in the
  Document gallery (chosen for VR-07 — the alternative leaks private
  images); (b) deleting a Comment deletes its images from the Document
  too; (c) a Document Owner/Master can remove a Comment's image from the
  gallery, but only the author can add/remove it from the Comment
  itself; (d) 4 images per Comment; (e) a Comment still needs text — no
  image-only Comments. The public-bucket caveat above applies to these
  images as well.
- ~~URL-import SSRF guard doesn't cover DNS rebinding~~ — resolved
  2026-09-22 (connection pinned to the validated IP, see Code review 04
  fixes).
- **Storage sweeper runs in-process (new, 2026-09-22)**: one task per
  backend process, so several workers each sweep (harmless, removal is
  idempotent). If the backend is ever scaled out or runs serverless, move
  it to a scheduled job.
- **Account page: decisions (2026-09-22)**:
  (a) profile fields, including the description, are visible to every
  member of the Rooms a user shares. **Kept for now**: a user-privacy
  strategy will be planned together with the future "Friend" feature
  (out of scope today).
  (b) the email is still sent to Room members and used as the fallback
  name and in pickers. **Undecided, left as is** for this stage.
  (c) limits 60/40/1000 chars and 512px square avatars: **confirmed**.
  (d) avatars shared the public-bucket caveat. **Resolved**: the bucket
  is private for all images (see Completed).
  (e) name and avatar from Google. **Done**: copied once as defaults,
  then owned by the user (see Completed).
- ~~RLS as defense-in-depth~~ — RLS is now on for every table, each with
  the restrictive `backend_only_deny_clients` policy denying `anon` and
  `authenticated` everything (backend-only; 2026-09-22, migrations
  `c9d4e7b1f352` and `f1c8a2e6d493`). Only the question of adding
  policies that *allow* some future direct client access remains, in
  `architecture.md` → Open items.
- **Supabase dashboard lints (2026-09-22)**: the "RLS enabled, no policy"
  notices were addressed with explicit deny policies (see Completed).
  Re-check Supabase's Security Advisor: no RLS findings should remain.
- **Document mentions: choices to confirm (new, 2026-09-22)**:
  (a) mentions are stored as plain `#Name` text, so **renaming a
  Document or Tag breaks existing mentions** of it, two Documents with
  the same name resolve to the first one, and a Document wins over a Tag
  with the same name; (b) **no backlinks** yet (FR-D4
  asks for them), which will need mentions stored server-side (see
  `architecture.md` → Open items); (c) the list shows at most 8
  Documents and Tags, and a Document can mention itself; (d) a Document
  created from the popup gets **Room** visibility (user's choice), so
  creating one from a Private/Selective Comment shows its *name* to the
  whole Room; (e) creating from the popup needs ↓ then Enter (a plain
  Enter is a newline). Change any of these if they don't fit.
- Agent export format, JSON vs. Markdown vs. both
  (`architecture.md` → Open items, FR-G1): decide when the export
  endpoint is designed, not needed for the Auth unit.

## Architecture Decisions

- Stack: React + Vite + TypeScript (frontend), FastAPI/Python
  (backend), Supabase for Postgres + Auth (Google OAuth) + Storage.
  Chosen for a small team/solo build wanting managed auth/DB/storage
  without standing up separate infra.
- Frontend never talks to Postgres/Storage directly — all domain
  reads/writes go through the FastAPI backend, so visibility and
  ownership rules live in exactly one place (`backend/app/domain/`).
  Chosen because the visibility model (VR-01…VR-11) has cross-cutting
  rules (e.g. VR-04, Reveal + audit log) that would be error-prone to
  duplicate in per-table RLS policies. RLS may be added later as a
  second safety net, not as the primary mechanism.
- Mono-repo layout (`/frontend`, `/backend`, `/context`) — simpler to
  keep the context files in sync with a single-person/small-team
  build than two repos each carrying their own copy.
- Backend talks to Postgres directly via SQLAlchemy async + Alembic,
  not Supabase's REST/`supabase-py` client, and app tables have no
  DB-level FK to `auth.users` — full reasoning in `architecture.md` →
  Backend Data Access (added 2026-09-21 with the Rooms/Membership
  slice).
- Document images are proxied through the backend (validate → downscale
  → WebP → Storage upload with the secret key) rather than uploaded
  client-side via signed URLs — full reasoning in `architecture.md` →
  Storage Model (added 2026-09-21 with the Document images unit).
- Comment images are Document images linked by `document_images.post_id`
  and filtered per viewer by the Comment's visibility — see
  `architecture.md` → Storage Model → Threads/Posts (added 2026-09-21
  with the Comments refactor).
- User profiles live on the existing `users` mirror (not a separate
  table), avatars reuse the Document image pipeline with a square-crop
  option, and the Storage sweep treats `users.avatar_path` as a
  reference — see `architecture.md` → Storage Model → User profiles
  (added 2026-09-22 with the Account page).
- The images bucket is private and responses carry 1-hour signed links,
  signed in one batch per response and reused from an in-process cache.
  Chosen over proxying image bytes through the backend (which would
  cost bandwidth and lose the CDN). See `architecture.md` → Storage
  Model (2026-09-22).
- Storage objects are kept consistent with `document_images` by a
  `storage_cleanup` outbox table plus post-commit removal and a background
  sweep, not by best-effort compensation inside the request. See
  `architecture.md` → Storage Model (added 2026-09-22 with the code
  review 04 fixes).

## Session Notes

- Full product spec with stable IDs lives in `context/requirements.md`
  (v0.3 as of 2026-09-21) — every other context file cross-references
  it by ID (`D-`, `FR-`, `UC-`, `VR-`, `I-`, `OQ-`). Read it first when
  an ID reference is unclear.
- Setup + Auth, Rooms + Membership, Manage members/roles, Documents
  (CRUD only), Document images, the Document UI redefinition,
  Comments and the Comments refactor (images on Comments) are all
  **done** as of 2026-09-21. Details/Threads is the
  natural next slice (see Next Up #1) but hasn't been started.
- The branch `feature/Gestione_membri_ruoli` ended up covering both the
  Manage members/roles unit AND the Documents unit — the user never cut
  a fresh branch for Documents, and nothing in `ai-workflow-rules.md`
  requires one branch per unit, so work continued there rather than
  stopping to ask. The Document images, Comments and Comments
  refactor features landed here too. Worth a
  heads-up before merging/opening a PR, since
  its name undersells what it now contains (same kind of mismatch as
  the `0ec23ce` commit message noted earlier in this file).
- **Architecture decision (2026-09-23, spec 07)**: the favorite image is a
  `document_images.is_favorite` flag with a partial unique index, not a
  `documents.favorite_image_id` FK. The FK makes "only one" structural too,
  but the flag keeps the state on the image — which is what gets deleted,
  cascaded from a Comment, and filtered per viewer — and lets one
  `ORDER BY is_favorite DESC, created_at, id` serve every read path without
  a join. The "exactly one while images exist" half is application logic
  (`next_favorite_id`), since the database can't promote a successor.
- **Not visually verified (2026-09-23)**: the spec 07 frontend was built,
  type-checked and unit-tested, but never rendered in a browser. The earlier
  headless layout checks in this file used an ad-hoc browser driver that was
  never committed, and reproducing one needs the backend up and a real signed
  -in Supabase session. Two things are worth a human eye (Next Up #0): the
  card below `sm`, where the half-width image column is tightest, and the
  carousel arrows, which depend on out-sitting the card's link overlay
  (`zIndex` 2 vs 1) — that ordering is correct by construction but unproven.
