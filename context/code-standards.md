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

## Documentation

Every module, class and function in `backend/app/`, and every export
in `frontend/src/` (outside tests), carries a docstring / JSDoc block.
Adopted 2026-09-23. It supersedes the code review 04 call not to chase
docstring coverage (`progress-tracker.md`), and the concern behind that
call stays as the rule for what goes in one:

- **Say what the signature can't**: the rule it enforces, why it
  exists, what it refuses and with which status, what the caller must
  do next. On the `get_document` route, "Gets a document" adds
  nothing; "404 whether it doesn't exist or the requester can't see it
  (VR-07)" does.
- **Cite the spec by ID** (`D-12`, `VR-07`, `Invariant 1`, `spec 07`)
  when the code implements a decision from `requirements.md`,
  `architecture.md` or a `context/feature/` spec, so a reader can
  find the reasoning.
- **Prose, not templates**: no `Args:`/`Returns:` or `@param`/`@returns`
  sections — types already say that. Open with a phrase describing the
  thing ("The caller's Membership in the Room, or 403…"), not "This
  function…".
- **Python format**: `"""Text."""` on one line when it fits, otherwise
  wrapped at ~79 columns with the closing `"""` on the last text line.
  A class docstring is followed by a blank line; an exception class
  with only a docstring needs no `pass`. An `__init__` is covered by
  its class's docstring. Route handler docstrings also become the
  endpoint's description in the OpenAPI docs (`/docs`), so write them
  for an API consumer too.
- **TypeScript format**: `/** Text. */` when it fits in 100 columns,
  otherwise a `/** … */` block wrapped at ~80. A comment on an
  interface field (a props field included) is JSDoc too, so it shows on
  hover. Inline `//` comments stay for implementation notes inside a
  body.
- **Keep it true**: a change that makes a docstring wrong updates it in
  the same commit. A stale docstring is worse than none.

Enforcement: the backend's `ruff check` selects pydocstyle's `D1`
rules (missing docstrings on public modules, classes, functions and
methods; `D107` ignored; `tests/` and `migrations/` exempt), so CI fails
on an undocumented public name. Private `_helpers` aren't checked but
are documented anyway when the reason isn't obvious. oxlint has no
"require JSDoc" rule, so the frontend convention is enforced in review
only.

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

## UI Text (frontend)

Adopted 2026-09-24 (spec 09); see `architecture.md` → UI Language.

- **No hardcoded UI strings.** Every piece of text a user can see or hear
  (labels, placeholders, `aria-label`s, tooltips, `alt` text, toasts,
  validation messages) comes from `src/i18n/locales/*.json` through `t()`:
  `useTranslation()` in a component, `i18n.t()` from `src/i18n` in a plain
  helper. Brand names (sign-in providers) and user content are the only
  literals.
- **A new string goes in every language in the same change.** `it.json`
  is the typed source (`i18next.d.ts`), and `locales.test.ts` fails on a
  key missing from `en.json` or a placeholder that differs.
- **Keys** are nested by area and named for what the text is, not what it
  says (`documents.detail.notFound`, not `documents.documentoNonTrovato`).
  Reuse a `common.*` key only when the meaning is really the same. The
  same word can need different translations in different places.
- **Compose with interpolation and plurals, never concatenation**:
  `t('documents.ownersLine', { names })`, `t('mentions.tagDetail', { count })`
  with `_one`/`_other` keys. Word order and plural rules differ between
  languages.
- **Locale-sensitive formatting** (dates, relative times, sorting by
  name) uses `currentLanguage()`, never a hardcoded locale.

## Testing (frontend)

Vitest + React Testing Library, run with `npm test`; coverage with
`npm run test:coverage` (config and floors in `vitest.config.ts`).

- A test file sits next to what it tests (`useRooms.ts` →
  `useRooms.test.ts`), so a module and its tests move together.
- **Tests run in Italian**: `src/test/setup.ts` resets the language to
  `it` (and clears `localStorage`) before each test, so existing
  assertions query the real Italian strings. A test about English, or
  about switching languages, calls `setLanguage('en')` itself.
- **Query the way a user finds things**: by role and accessible name
  (`getByRole('button', { name: 'Elimina' })`), not by class or
  test id. A query that needs a `data-testid` usually means the
  component is missing a label. Mantine notes: a `Select` and a
  `MultiSelect` are `combobox`, and a `required` field's label
  includes the asterisk, so match it with a regex.
- **Render through `src/test/utils.tsx`** (`renderWithProviders`,
  `renderHookWithProviders`), which supplies the same
  Mantine/TanStack Query/Router stack as `main.tsx`. Its `wrapper`
  option nests an extra provider when one is needed. Never build a
  bare `QueryClient` in a test: the shared one disables retries, so
  a deliberate failure doesn't stall the test.
- **Mock at the network boundary, not deeper**: `vi.mock` on
  `lib/apiClient`, then assert the path, method and body a hook
  sends. Fixtures in `src/test/fixtures.ts` stay in the backend's
  snake_case wire shape — building them in camelCase would test the
  mapping against itself. When one test triggers a refetch, mock per
  route (path + method), or an invalidated list comes back as the
  single object the mutation returned.
- **Test the rule, not the render**: prefer a case that pins a
  decision from `requirements.md`/`architecture.md` (a `VR-`
  visibility rule, who may edit, what the cache invalidates) over one
  that restates the markup. Where a test encodes such a rule, name
  the ID in a comment.
- Permission flags (`can_edit`, `can_delete`, …) come from the
  backend: assert the UI *honors* them, never that it re-derives
  them.
- `src/test/setup.ts` holds the jsdom gaps Mantine and Embla need
  (`ResizeObserver`, `IntersectionObserver`, `matchMedia`,
  `document.fonts`, pointer capture). Add to it rather than stubbing
  the same thing per file.

## Testing (backend)

pytest, split by what a test needs rather than by what it covers.

- A test that requests the `db_session` fixture talks to whatever
  database `DATABASE_URL` points at (the Supabase project locally, a
  throwaway Postgres in CI) and is marked `integration` automatically
  (`tests/conftest.py`). Don't add the marker by hand, and don't reach
  for the database from a test that doesn't need it: those tests are
  slower and need a database to run at all.
- Business rules belong in `tests/test_domain_*.py`, with plain
  dataclasses and no database, mirroring the rule that
  `app/domain/` is framework-independent. CI gates on ≥95% of
  `app/domain`, so a new invariant needs one.
- CI runs the whole suite, database tests included, and gates on ≥90%
  of `app/`. Locally, `pytest -m "not integration"` needs no database;
  the full `pytest` needs a `backend/.env`. A new migration that uses
  more of Supabase than `tests/ci/supabase_shim.sql` provides extends
  the shim. See `architecture.md` → Continuous Integration.

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

- Every migration that creates a table in `public` also enables RLS
  and adds the explicit deny policy (tables are backend-only, see
  `architecture.md` → Backend Data Access):

  ```sql
  ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
  CREATE POLICY backend_only_deny_clients ON public.<table>
    AS RESTRICTIVE FOR ALL TO anon, authenticated
    USING (false) WITH CHECK (false);
  ```

  `tests/test_database_security.py` fails otherwise. Never grant
  anything to `anon` or `authenticated`, and never add a permissive
  policy for them (including dashboard-suggested ones).

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
