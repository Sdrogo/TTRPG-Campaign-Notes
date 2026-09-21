# Progress Tracker

Update this file after every meaningful implementation change.

## Current Phase

- **Setup + Auth unit complete** (2026-09-21). The user confirmed a real
  Google login on the running `HomePage`: Supabase issued a session
  (`andreapartenope@gmail.com`) and the backend's `/auth/me` verified the
  JWT and returned the matching `id`/`email` (UC-01, FR-A1, FR-A2 all
  satisfied end to end). Next unit is Rooms + Membership.

## Current Goal

- Rooms + Membership (UC-02, UC-04): a signed-in user can create a Room
  (becoming Administrator + Master, with default Tags created) or join
  one via an invite link (becoming Player by default).

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

## In Progress

- None yet.

## Next Up

1. Rooms + Membership (UC-02, UC-04): create a Room (creator becomes
   Administrator + Master, default Tags created per D-14/FR-N1),
   generate/accept an invite (FR-R2, FR-R3), join with the Player role
   by default. Implements the working proposals for OQ-09/OQ-10 from
   `requirements.md` §6 (still marked provisional there) — flag it
   explicitly if anything in this slice needs the proposal firmed up
   into a `D-` decision first.

## Open Questions

- OQ-09 · OQ-10 · OQ-11 · OQ-12 from `requirements.md` (section 6)
  are not yet resolved — flagged here as a reminder they block the
  Rooms/Membership and Documents/Details units, not the Auth unit.
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

## Session Notes

- Full product spec with stable IDs lives in `context/requirements.md`
  (v0.2) — every other context file cross-references it by ID
  (`D-`, `FR-`, `UC-`, `VR-`, `I-`, `OQ-`). Read it first when an ID
  reference is unclear.
- First implementation unit, Setup + Auth, is **done** — repo
  scaffolding, Supabase wiring, and the Google login path are all
  verified (automated checks, headless smoke tests, and a real login by
  the user). Rooms + Membership (Next Up #1) is the active unit now.
