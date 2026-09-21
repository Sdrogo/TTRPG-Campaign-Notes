# Progress Tracker

Update this file after every meaningful implementation change.

## Current Phase

- **Setup + Auth unit complete** (2026-09-21).
- **Rooms + Membership unit complete** (2026-09-21).
- **Manage members/roles unit complete** (2026-09-21, branch
  `feature/Gestione_membri_ruoli`): backend and frontend both done and
  verified (automated tests + a headless regression check; live click-
  through of the role/admin/remove UI is still worth the user doing
  when convenient, same caveat as Rooms+Membership's frontend — no
  password-login path exists to drive it headlessly). UC-05, FR-R4,
  FR-R5, FR-R7 and D-16/Invariant 5 are satisfied end to end, including
  a first AuditLog implementation (NFR-06). Next unit: not yet chosen
  — see Next Up.

## Current Goal

- Documents (FR-D1–D4, D-05, D-12, D-19, D-20): CRUD with name, image,
  description, Tags, and Ownership, plus Details as titled Posts in
  the Document's one main Thread. Not yet started — see Next Up for
  how it's likely to be split into steps.

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

## In Progress

- None yet.

## Next Up

1. Documents (FR-D1–D4, D-05, D-12): CRUD with name, image, description
   (rich text/Markdown), Tags; Ownership model (creator + Master are
   Owners, D-12); only an Owner edits the description (D-03); Details
   as titled top-level Posts in the one main Thread (D-18, D-19, D-20,
   FR-D3) — no longer blocked, OQ-11/OQ-12 resolved (see Open
   Questions). Given the size, likely still worth splitting further:
   plain Document CRUD first, Details/Thread as a following slice
   within the same unit.
2. Visibility (VR-01…VR-11) will end up threaded through whatever unit
   touches Documents/Posts first, per Invariant 1 — worth deciding
   alongside #1 rather than bolting on later.

## Open Questions

- OQ-09 · OQ-10 from `requirements.md` (section 6) are formally
  unresolved (no `D-` number assigned) but now fully implemented in
  practice: creator = Administrator + Master on creation (OQ-09), and
  the last-Administrator/last-Master successor requirement (OQ-10/D-16)
  is enforced by the Manage members/roles unit above.
- **Resolved (2026-09-21):** OQ-11 and OQ-12 are now `requirements.md`
  D-19 and D-20 (v0.3) — who can add a Detail and how it behaves
  (D-19), and confirmation that a Document has only its one main
  Thread in v1 (D-20). Two new invariants, I-10 and I-11, were added
  alongside them. This unblocks the Documents unit (Next Up #1); no
  requirements-level blocker remains for it.
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
  (v0.2) — every other context file cross-references it by ID
  (`D-`, `FR-`, `UC-`, `VR-`, `I-`, `OQ-`). Read it first when an ID
  reference is unclear.
- First implementation unit, Setup + Auth, is **done** — repo
  scaffolding, Supabase wiring, and the Google login path are all
  verified (automated checks, headless smoke tests, and a real login by
  the user). Rooms + Membership (Next Up #1) is the active unit now.
