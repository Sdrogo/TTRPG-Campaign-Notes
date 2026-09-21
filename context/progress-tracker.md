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

## In Progress

- None yet.

## Next Up

1. Rest of Threads on top of the new `posts` table: nested replies
   (FR-T1/T2) with D-17/VR-04's "never wider than the parent" check in
   the domain layer (Invariant 3), and pagination (FR-T3) if Comment
   counts grow. Comments are currently flat and loaded all at once.
2. Details/Threads (D-18, D-19, D-20, FR-D3, FR-T1, FR-T5–T7): the
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
- **Document image privacy (new, 2026-09-21)**: the `document-images`
  bucket is public. Paths are unguessable, but a URL someone has already
  seen keeps working after the Document is made Private/Master-only, and
  even briefly after the image is deleted (CDN cache, confirmed live).
  If that matters for VR-07, switch to a private bucket + short-lived
  signed read URLs issued per response. Needs a product decision.
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
- URL-import SSRF guard doesn't cover DNS rebinding (host re-resolved by
  httpx after the check). Acceptable for now; revisit if the backend
  ever runs next to sensitive internal services.
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
- Document images are proxied through the backend (validate → downscale
  → WebP → Storage upload with the secret key) rather than uploaded
  client-side via signed URLs — full reasoning in `architecture.md` →
  Storage Model (added 2026-09-21 with the Document images unit).
- Comment images are Document images linked by `document_images.post_id`
  and filtered per viewer by the Comment's visibility — see
  `architecture.md` → Storage Model → Threads/Posts (added 2026-09-21
  with the Comments refactor).

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
