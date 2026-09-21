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
  Also deferred: image upload (needs Supabase Storage, D-09), version
  history (FR-D5, Should), draft/published status (FR-D6, Could),
  cross-Document mentions/backlinks (FR-D4).

## Current Goal

- None set yet for the next unit. Two candidates, not yet chosen (see
  Next Up): Details/Threads (the natural completion of the Documents
  unit) or starting fresh on Visibility's remaining pieces (Reveal
  action + AuditLog, "view as User X").

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

## In Progress

- None yet.

## Next Up

1. Details/Threads (D-18, D-19, D-20, FR-D3, FR-T1, FR-T5–T7): the
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
2. Image upload for Documents (D-09, FR-D1) — needs Supabase Storage
   wiring (architecture.md: backend authorizes a scoped upload
   reference, client never uploads with a raw bucket key). Not started;
   no blocker, just deferred for scope.
3. Reveal action + fuller Visibility (VR-02, VR-05, VR-06, FR-V2, FR-V3,
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
- RLS as defense-in-depth (`architecture.md` → Open items): decide
  before or after the MVP ships.
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

## Session Notes

- Full product spec with stable IDs lives in `context/requirements.md`
  (v0.3 as of 2026-09-21) — every other context file cross-references
  it by ID (`D-`, `FR-`, `UC-`, `VR-`, `I-`, `OQ-`). Read it first when
  an ID reference is unclear.
- Setup + Auth, Rooms + Membership, Manage members/roles, and Documents
  (CRUD only) are all **done** as of 2026-09-21. Details/Threads is the
  natural next slice (see Next Up #1) but hasn't been started.
- The branch `feature/Gestione_membri_ruoli` ended up covering both the
  Manage members/roles unit AND the Documents unit — the user never cut
  a fresh branch for Documents, and nothing in `ai-workflow-rules.md`
  requires one branch per unit, so work continued there rather than
  stopping to ask. Worth a heads-up before merging/opening a PR, since
  its name undersells what it now contains (same kind of mismatch as
  the `0ec23ce` commit message noted earlier in this file).
