# Code Standards

This project is two codebases (`frontend/`, `backend/` — see
`architecture.md`), so the framework-specific section below is
split in two instead of one. Everything else applies to both.

## General

- Keep modules small and single-purpose — a file that mixes API
  wiring, business rules and data access is a sign to split it
  along the `api/` / `domain/` / `db/` boundary from `architecture.md`.
- Fix root causes, do not layer workarounds — especially around
  visibility and ownership checks: if a rule is missing, add it to
  `backend/app/domain/`, don't patch around it in a route handler.
- Do not mix unrelated concerns in one component, route, or module
  (e.g. a Document route handler must not also contain Thread logic).
- Every rule in `architecture.md`'s Invariants section is a hard
  constraint on the code, not a guideline — a change that would
  violate one needs the invariant updated first (see
  `ai-workflow-rules.md`).

## TypeScript (frontend)

- Strict mode required throughout `frontend/`.
- Avoid `any` — use explicit interfaces or narrowly scoped types;
  API response shapes get a typed model, not inline object literals
  scattered across components.
- Validate unknown external input (API responses, form input) at the
  boundary before trusting it in a component.
- One type/interface per domain concept (`Document`, `Room`,
  `Membership`, `Post`, `VisibilityLevel`, …), shared from a single
  `types/` module — never redefined ad hoc per component.

## Python (backend)

- Type hints required throughout `backend/`; run under strict mypy
  (or pyright) settings — no untyped `def`.
- Pydantic models validate and parse every request body and query
  param at the API boundary before any domain code runs.
- Domain logic in `backend/app/domain/` must not import FastAPI or
  Supabase client code — it takes plain data in, returns plain data
  out, so it can be unit-tested without a running server or database.
- Prefer explicit, narrow exceptions (e.g. `NotOwnerError`,
  `VisibilityViolation`) over generic ones, so route handlers can map
  them to the right HTTP status without guessing.

## Frontend (React + Vite)

- Function components with hooks only — no class components.
- Keep a component focused on rendering; data fetching and mutation
  logic live in hooks (`hooks/`), not inline in the component body.
- Server state (Rooms, Documents, Threads, …) is managed through a
  query/cache layer (e.g. TanStack Query) — do not hand-roll
  `useEffect`-based fetching for data the backend owns.
- Build UI from Mantine primitives per `ui-context.md`; a custom
  component is justified only when Mantine has no equivalent or the
  app needs domain-specific behavior (`VisibilityBadge`, `RoleTag`).

## Backend (FastAPI)

- Route handlers stay thin: parse/validate input (Pydantic), call
  one domain function, translate the result/exception to a response.
  No business rules inline in a route handler.
- One router module per resource, matching the boundaries in
  `architecture.md` (`rooms`, `documents`, `threads`, `tags`,
  `glossary`, `visibility`, `invitations`, `export`).
- Dependency-injected auth: every protected route takes the
  authenticated user (resolved from the Supabase JWT in
  `backend/app/auth/`) as a FastAPI dependency — never re-parse the
  token manually inside a handler.

## Styling

- Mantine theme tokens only (see `ui-context.md`) — no hardcoded hex
  values or ad hoc spacing/radius in component code.
- Follow the border radius scale defined in `ui-context.md`; do not
  introduce a new radius value without updating that file first.
- Dark theme only — do not add light-mode-only styling or assume a
  `prefers-color-scheme: light` branch exists.

## API Routes

- Validate and parse request input (Pydantic) before any logic runs.
- Enforce role and Ownership checks **before** any mutation, and the
  visibility filter **before** any content is included in a response
  — this is Invariant 6 in `architecture.md`, not optional per-route.
- Return consistent, predictable response shapes: a resource always
  serializes the same way regardless of which route returned it: no
  bespoke per-route field renaming or shape drift.
- Every response that lists or returns Room content must have gone
  through the domain-layer visibility filter — a route that reads
  from `db/` and returns the result directly, unfiltered, is a bug
  (Invariant 1, `architecture.md`).
- Every visibility change, Reveal action, role change, and Ownership
  transfer writes an AuditLog entry in the same transaction as the
  change (Invariant 7, `architecture.md`) — not as a best-effort
  follow-up call.

## Data and Storage

- Every migration that creates a table in `public` also runs
  `ALTER TABLE … ENABLE ROW LEVEL SECURITY` and adds no policies (tables
  are backend-only, see `architecture.md` → Backend Data Access).
  `tests/test_database_security.py` fails otherwise. Never grant
  anything to `anon` or `authenticated`.

- Metadata belongs in Postgres (Supabase): Rooms, Memberships,
  Documents, Tags, GlossaryEntries, Threads/Posts, Invitations,
  VisibilityRule, AuditLog.
- Document images and other uploaded media belong in Supabase
  Storage; Postgres stores only the reference (path/URL), never the
  file bytes.
- Do not store large generated content (e.g. a full Agent export
  payload) directly in a table row meant for interactive reads —
  generate exports on demand from the normalized data instead of
  caching a denormalized blob, unless a specific performance need
  justifies it later.

## File Organization

**`frontend/`**
- `src/components/` — Mantine-based UI components, including the
  app-specific ones noted in `ui-context.md`.
- `src/hooks/` — data fetching/mutation hooks per resource.
- `src/pages/` (or `routes/`) — top-level routed views (Room view,
  Document detail, invite acceptance, …).
- `src/types/` — shared TypeScript types for domain models.

**`backend/app/`**
- `api/` — FastAPI routers, one per resource; thin, no business rules.
- `domain/` — business rules and invariants; framework-independent.
- `db/` — Postgres queries/repositories and Supabase Storage calls.
- `auth/` — Supabase JWT verification and user/session resolution.

**`context/`**
- Shared spec and context files (this folder) — read by both
  codebases and any Agent; not part of either app's build output.
