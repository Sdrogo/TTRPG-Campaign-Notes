# Progress Tracker

Update this file after every meaningful implementation change. Keep entries
short: a few lines per unit, with the *why* and anything a future session
must know. The full per-unit history (test counts, headless-check logs,
step-by-step notes) is in
[`archive/progress-tracker-full-2026-09-30.md`](archive/progress-tracker-full-2026-09-30.md)
— read it only when you need that detail.

## Current Status (2026-10-01)

Branch `feature/12-1-notes-backend` (spec 12_1, backend only). Latest measured
state: backend **412** tests pass against the live DB (migrations
`b5d8f2a9c1e3` and `c6e1a4b7d2f9` are both applied to it); new modules at
100% coverage, ruff and mypy strict clean. Frontend untouched (spec 12_2 is
the next unit). CI keeps exact-100% gates.

## Completed Units

Dates are 2026-09 unless noted. Spec files live in `context/feature/`.

### Member removal loading (09-30)

- The member table shows loading only for the user being removed or leaving;
  pending-state regression cases cover both actions and other rows.

### Foundations (09-21)

- **Scaffolding**: mono-repo; `frontend/` (React + Vite + TS strict, Mantine
  v9, TanStack Query, React Router, self-hosted fonts, Phosphor icons,
  oxlint) and `backend/` (FastAPI, Python 3.14, strict mypy + ruff, pytest).
  Single root `.gitignore`.
- **Supabase + Auth**: backend verifies ES256 JWTs via the project's JWKS
  endpoint (no shared secret); `CurrentUserDep` is the only way a handler
  gets the user. Live Google login confirmed by the user.
- **Backend data access**: SQLAlchemy 2.0 async (`asyncpg`) + Alembic
  through Supabase's **Session Pooler** (direct host is IPv6-only). App
  tables have no FK to `auth.users`. See `architecture.md`.
- **Rooms + Membership**: Rooms, Memberships, Invitations, default Tags;
  pure domain layer in `app/domain/`; DB integration tests run in
  rolled-back savepoints.
- **Manage members/roles (UC-05/UC-19)**: D-16 "never lose the last Master/
  Administrator" guard; `users` mirror table; `audit_log` (Invariant 7).

### Documents and Comments (09-21 → 09-22)

- **Documents**: CRUD, Tags, Owners (Master is an implicit Owner, D-12),
  Visibility filter (Room/Master/Private/Selective) in
  `app/domain/visibility.py`. A hidden Document returns **404, not 403**
  (VR-07). Details/Threads (D-18–D-20, FR-D3), version history (FR-D5) and
  draft status (FR-D6) deliberately deferred.
- **Document images**: several per Document, from file or URL; proxied
  through the backend (validate → downscale ≤1920px → WebP → Storage) with
  an SSRF-guarded fetcher; max 20 per Document.
- **Document UI redefinition**: responsive full-width detail card, emails/
  names instead of ids (data backfill migration `d3e8a1f4c2b7`), shared
  `PageLayout`/`PageState`/`TagList`/`DocumentFields` components.
- **Comments**: flat Comments in the Document's one Thread (FR-T1, FR-T5,
  VR-03) in the `posts` table; author-only editing, author/Master deletion
  with placeholder; sort/filter toolbar; AuditLog on visibility change.
- **Comments refactor**: composer below the list; Comment images are
  Document images linked via `document_images.post_id` and **inherit the
  Comment's visibility** (otherwise private images leak through the
  gallery); max 4 per Comment.
- **Code review 04 fixes**: duplicate-id dedupe, email not wiped by empty
  claim, DNS-rebinding-proof URL fetch (pinned IP), Storage/DB consistency
  via a `storage_cleanup` outbox table + post-commit removal + background
  sweeper, row lock on the image-count check.

### Account, security, navigation (09-22)

- **Account page** (FR-A2): display name, avatar, pronouns, bio on `users`;
  avatar button top right on every page; users shown by display name, then
  email. Google name/picture copied once as defaults (`profile_prefilled_at`).
- **Private image bucket**: all images private; responses carry 1-hour
  signed links, signed in one batch per response, cached in-process.
- **Database lockdown**: Supabase flagged "RLS Disabled in Public"; every
  table was readable with the public key. Migration `c9d4e7b1f352` enables
  RLS and revokes client grants on all tables; `f1c8a2e6d493` adds an
  explicit restrictive `backend_only_deny_clients` policy. A stray
  `on_auth_user_created` trigger that would have broken sign-up was dropped.
  Guard tests in `tests/test_database_security.py`. Every new
  table-creating migration must do the same (`code-standards.md`).
- **Quick navigation** (first slice of FR-D4, FR-N2): typing `#` in a
  description or Comment opens a popup of Room Documents and Tags; picks
  write plain `#Name` text resolved at render time against the viewer's own
  visible list (so hidden Documents reveal nothing). Popup can create a
  blank Document or Tag from the typed name. `?tag=` URL filter on the
  Documents list.

### Documents list, CI, quality (09-23)

- **Document card images + Tags (spec 07)**: card shows Tags and a carousel;
  **favorite image** = `document_images.is_favorite` with a partial unique
  index; favorite writes serialized by the Document row lock; Documents
  list batched to a fixed number of queries. Spec 07.1: images framed by
  orientation (landscape/portrait) via `lib/images.ts`.
- **Frontend test stack** (RTL, jsdom, coverage) and **CI**
  (`.github/workflows/ci.yml`): lint, build, coverage gates, ruff, mypy, and
  the full backend suite (incl. DB tests) against a throwaway Postgres 17.6
  with `tests/ci/supabase_shim.sql`. No secrets needed. Not covered by CI:
  real Storage, differences between the shim and real Supabase,
  concurrency.
- **Docstring coverage**: 100% of backend `app/` (ruff `D1` gate in CI) and
  100% of frontend exports (JSDoc, review-only). Rule in `code-standards.md`
  → Documentation.
- **CORS for Vercel previews**: optional `CORS_ORIGIN_REGEX`. See Next Up —
  Render holds a looser pattern than the one decided.
- **Auth expansion (spec 08)**: Discord, Facebook, GitHub and X alongside
  Google (Google stays the filled button). X uses Supabase id `x`. Handles
  are a display-name fallback. Providers in `lib/authProviders.ts`.

### Localization (09-24 → 09-25)

- **UI i18n (spec 09)**: Italian + English via `react-i18next`, resources in
  `src/i18n/locales/{it,en}.json`; starts from the browser language, English
  fallback, flag selector in the header stores only an explicit pick.
- **Backend i18n (spec 09_1)**: every `HTTPException` detail is a
  translation key rendered from `app/i18n/locales/{en,it}.json` using the
  `Accept-Language` header; domain exceptions carry a `key` + params
  (`DomainError`) so `app/domain/` stays i18n-free. Default Tags are stored
  data and deliberately not localized.

### UX refinement (spec 10, 09-25 → 09-27, branch `feature/ux_refinement`)

- Documents grouped by **Main Tag** (= a Tag with category `"Type"`; PC
  added to defaults), group-by/sort via `?groupBy=`/`?sort=`, collapsible
  groups; Glossary/Tag Index drawer from a header burger (a lightweight
  navigation over Tags, **not** the full FR-N3/N4 Glossary entity);
  clickable Tags on cards; detail-page images beside the text on `lg`+;
  inline Tag creation while editing (gated on `canManageTags` — it used to
  show for Players who'd get a 403); Document deletion (Owner/Master,
  confirmation modal; images go through `image_uploads.remove_images` first
  since a DB cascade would orphan Storage objects); fixed a stale-closure
  overwrite in inline Tag creation.
- Smart back button: prefers real browser history, falls back to a fixed
  destination; now lives in `AppHeader`. Burger moved to the header's left;
  the filter row beside the Documents title collapses independently.
- **PC-tag migrations `d8a2f5c1b976` and `f3b8e2a71c94` applied to the live
  DB** (2026-09-26, with the user's go-ahead each time).
- Accent CSS tokens aligned with Mantine red shades 6/5 (09-26).
- **100% test coverage (09-27)**: frontend 100% (761 tests), backend 100%
  (328 tests); gates raised to exact 100%. Remaining `# pragma: no cover`
  is commented: real DB session, real Storage HTTP, real JWKS client, and
  unreachable "room is None" guards (no route deletes a Room).

### Room setup page (spec 11, 09-30, branch `feature/11-room-setup-page`)

- **Backend first** (commit 1): `tags.main_position` (migration
  `a7c3e9d1b254`) makes "Main Tag" an Administrator's choice with an order,
  replacing "category `Type`". Existing `Type` Tags were promoted by name
  order; new Rooms seed the defaults as Main Tags in `DEFAULT_TAGS` order.
  `PUT /rooms/{id}/tags/main` (Administrator only) replaces the selection;
  rule in `app/domain/tags.py`.
- **Frontend** (commit 2): `RoomSetupPage` at `/rooms/:id/setup`
  (Administrators only) replaces `RoomMembersPage` (old `/members` URL
  redirects). Built from `setup/MemberManagement` (the old table, now
  all-controls) and `setup/MainTagsEditor` (up/down/remove/add, one Save).
  Documents grouping and the Tag index follow the chosen order. `RoomCard`
  shows "Impostazioni" to Administrators only.

### UI/UX refinement 11.1 (09-30, branch `feature/11-1-tagfilter-one-line`)

- `TagFilter` is forced to one line: two pills then "+N", no wrapping
  (`renderPill`, since Mantine 9's `MultiSelect` lacks `maxDisplayedValues`).
  Frontend 800 tests, 100% coverage.
- Migration `a7c3e9d1b254` (spec 11) was **applied to the live DB on
  09-30** after the deployed backend returned 500 on `/tags` (the code had
  deployed before the migration). Apply migrations before merging.

## In Progress

### Notes on Documents, backend (spec 12_1, branch `feature/12-1-notes-backend`)

Backend and DB half of `context/feature/12 - add Notes to Documents.md`; the
UI is spec 12_2. Migration `c6e1a4b7d2f9` (two new empty tables) was **applied
to the live DB on 10-01** with the user's go-ahead, before the merge.

- A **Note** = `title` (≤200), `description` (plain text, `#Name` mentions,
  no length rule like a Document's), own **visibility**, `position`. Tables
  `document_notes` + `document_note_visibility_grants`, cascade from the
  Document, RLS + deny policy. **A Note is the Detail of D-18** (same feature,
  two names), implemented outside the Thread - see Open Questions.
- Visibility = `is_note_visible` (reuses `is_content_visible`, the Document's
  Owners as "Owner"). A hidden Note is absent from every response and a
  request for it is **404, not 403**; visibility is checked before permission.
- Owners + Master manage Notes (`app/domain/notes.py`). Visibility/grant
  changes write a `note_visibility_changed` AuditLog row (Invariant 7).
- API `app/api/notes.py`: list/create/PATCH/DELETE and `PUT .../notes/order`
  (a Note hidden from the reorderer keeps its slot). Notes are **embedded in
  every single-Document response** (`DocumentDetailResponse`) and **not** in
  the list. ≤50 per Document, enforced under the Document row lock.
- `ensure_room_members` moved to `api/access.py` (shared with Comments).
- Local note: a full local run once showed 6 uncovered lines in
  `api/comments.py` (a coverage-tracing flake; 100% in isolation and next to
  the Notes tests). CI is the gate.

### Tag combinations (spec 11_2, branch `feature/11-2-tag-combinations`)

Implementation is ready; completion is pending approval and application of
migration `b5d8f2a9c1e3` to the live DB (see Next Up).

- **Backend first**: a combination of two or more Tags is a line item of the
  Documents grouping, in the same order as the single Main Tags. Tables
  `tag_combinations` + `tag_combination_tags` (migration `b5d8f2a9c1e3`, RLS +
  deny policy); combinations share the numbering of `tags.main_position`.
  `GET`/`PUT /rooms/{id}/tags/main` moved to `app/api/main_items.py`.
  GET returns a raw list of `MainItem` objects (`[{tag_ids: [...]}]`);
  PUT accepts a top-level `items` field (`{items: [{tag_ids: [...]}]}`)
  and returns the saved raw list (**breaking** vs spec 11's `{tag_ids}`);
  rules in `app/domain/tags.py`.
- **Frontend**: `useMainItems`/`useSetMainItems`, `lib/mainItems.ts`,
  `groupDocumentsByMainItems` (a Document is in a combination when it has
  **all** its Tags); `MainTagsEditor` gained combinations through
  `CombinationAdder`; group headings read `#A + #B`.

## Next Up

- **Merge spec 12_1, then build 12_2** (frontend). Migration `c6e1a4b7d2f9`
  is already live; Render redeploys the backend on merge and the single-Document
  responses gain a `notes` field (additive, the old frontend ignores it).
- **Browser check of spec 11** (migration is applied): setup page as
  Administrator and as a plain member, reorder + save, Documents grouping
  follows the order; and the one-line `TagFilter` with 3+ Tags selected.
- **Tighten `CORS_ORIGIN_REGEX` on Render** (dashboard only): set it to
  `https://ttrpg-campaign-notes-[a-z0-9]+-rum11\.vercel\.app` and redeploy.
  Then the look-alike `…-abc123-evil-rum11.vercel.app` must get no
  `access-control-allow-origin` while a commit preview still does. Render
  currently holds the looser `[a-z0-9-]+` pattern. Low risk (Bearer header,
  no cookie) but not what was decided.
- **Verify in a browser** (built and unit-tested, never seen running): the
  Document card below `sm`, that carousel arrows beat the card's link
  overlay, that clicking an image opens the Document, portrait/landscape
  framing (spec 07/07.1); and the 09-27 header/back-button/collapsible-
  controls changes.
- **Try each sign-in provider on the deployed app** (spec 08): Discord,
  Facebook, GitHub, X round-trip, land on Rooms, pre-fill name/avatar; check
  an X account with no email. A Supabase error page means a dashboard
  setting, not app code. Facebook apps in Development mode only admit the
  app's testers. Also re-test a brand-new user's first sign-in live (the
  stray trigger was dropped but never re-tested).
- **Mention backlinks** (rest of FR-D4): store mentions server-side, show
  "Mentioned in" filtered per viewer, decide whether mentions survive a
  rename.
- **Threads** on the `posts` table: nested replies (FR-T1/T2) with the
  D-17/VR-04 "never wider than the parent" check in the domain layer
  (Invariant 3); pagination (FR-T3); D-20, FR-T5–T7. Details (D-18, FR-D3,
  FR-T10) already exist as **Notes** (spec 12), outside the Thread. Scope a
  first slice to FR-T1/T5 (post, edit/moderate).
- **Reveal action + fuller Visibility** (VR-02, VR-05, VR-06, FR-V2/V3/V5):
  per-Room default visibility, Reveal with AuditLog + notification, "view as
  User X" for the Master.
- **Backend locale vs UI language**: the frontend should send its picked
  language as `Accept-Language` so the two agree (see Open Questions).
- Decide whether new Rooms should get default Tags in the creator's
  language.

## Open Questions

Items marked *protected* need a product pass because `requirements.md` is a
protected file.

- **Spec 12 — Notes = Details (decided 2026-10-01, `requirements.md` needs a
  product pass, *protected*)**: the product owner confirmed a Note and a
  Dettaglio (D-18) are the same feature under two names, and chose to keep
  **Owner/Master-only** management. This departs from the spec: D-19/I-10 say
  any member who sees the Document may add a Detail, only its author or the
  Master may edit it, and it is a Thread Post with nested replies; FR-T8
  (promote a Detail into the description) and FR-T10 (a dedicated section on
  the Document card) also assume that model. Implemented instead: own tables,
  Owners + Master add/edit/delete/reorder, no replies, shown on the detail page
  only. Either amend D-19, I-10, FR-T8 and FR-T10 to this model, or move
  Notes onto `posts` (kind `detail`) later to get member-written Details and
  replies. Other choices to confirm: (a) Private = the Document's Owners +
  Master, and an Owner who sets a Note to "Master" stops seeing it; (b) Notes
  are in the single-Document responses, not the list or the card; (c) limits:
  200-char title, 50 per Document, no description limit; (d) reordering is
  kept; (e) the Selective grant list is sent only to those who can manage the
  Note; (f) the Agent export (FR-G1) doesn't exist yet and must apply the same
  filter. Tickets: `context/feature/12_1 - Note backend effort.md`,
  `12_2 - Note frontend effort.md`.

- **Spec 11_2 — combination semantics (assumed, confirm)**: the spec only
  says a combination of 2+ Tags can be a Group-by line item. Assumed: a
  Document is in it when it carries **all** the Tags (AND, like the filter);
  it also stays in the single-Tag groups it matches; any Tags can be combined
  (not only Main Tags); combinations can't be nested or named. Changing
  any of these needs a product pass.
- **Spec 11 — who may set up a Room, and leaving** (needs a product
  decision): the spec says the setup page is reachable only by a Room's
  Administrator, and it replaced the members page. So (a) a plain Player or
  a Master who isn't an Administrator can no longer see the members list
  page or **leave a Room from the UI** (UC-19; the `DELETE` endpoint still
  allows it) — a "Leave" action somewhere else (Rooms list card?) is
  needed; (b) the Master alone can't set Main Tags (Administrator only,
  matching "Admin of that Room"). Also new: who the "Admin" is when the
  Master isn't one (they are separate flags, D-11).

- **Backend locale follows `Accept-Language`, not the UI flag selector**: a
  user with an English browser who picked Italian in the UI still gets
  English API error text. Fix = frontend sends its language on every request.
- **UI language absent from `requirements.md`** (*protected*): add an NFR for
  supported languages and confirm English as fallback.
- **Auth passages in `requirements.md`** (*protected*): FR-A1 lists five
  providers, but UC-01, the section 5 User, NFR-03 and the MoSCoW **Won't**
  row still say Google-only. D-07 (Google preferred) still holds. NFR-03's
  privacy rule (only name, picture, email) applies to every provider.
- **Images spec gap** (*protected*): D-09/FR-D1 say "Immagine" (singular).
  The 20-per-Document cap and 1920px/WebP output are implementation choices.
- **OQ-09 / OQ-10** have no `D-` number but are implemented (creator =
  Administrator + Master; last-Master/Administrator guard). OQ-11/OQ-12 are
  resolved (D-19, D-20).
- **Comments — choices to confirm**: (a) the author always sees their own
  Comment, so "Solo Master" = me + the Master; (b) the Master can delete but
  not edit others' Comments; (c) moderation deletes aren't in the AuditLog;
  (d) 10,000-char body limit.
- **Comment images — choices to confirm**: (a) inherit the Comment's
  visibility, including in the gallery; (b) deleting a Comment deletes its
  images from the Document; (c) an Owner/Master can remove a Comment's image
  from the gallery, only the author can add/remove it from the Comment;
  (d) 4 per Comment; (e) no image-only Comments.
- **Account — decisions**: profile fields are visible to everyone in a
  shared Room (kept until the future Friend feature plans user privacy); the
  email is still sent to Room members and used as fallback name (undecided,
  left as is); limits 60/40/1000 chars and 512px avatars confirmed.
- **Document mentions — choices to confirm**: (a) plain `#Name` text, so
  renaming breaks mentions, duplicate names resolve to the first, a Document
  beats a same-named Tag; (b) no backlinks yet; (c) popup shows at most 8,
  and a Document can mention itself; (d) a Document created from the popup
  gets **Room** visibility even from a Private Comment (user's choice), so
  its name is shown to the whole Room; (e) creating from the popup needs ↓
  then Enter.
- **In-process caches/jobs**: the signed-link cache and the Storage sweeper
  are per backend process. Harmless with several workers (removal is
  idempotent); move the sweeper to a scheduled job if the backend ever runs
  serverless or scales out.
- **Stale image URLs**: a signed link already handed out works until it
  expires, and old public URLs may be served from the CDN cache for a while.
- **RLS**: all tables are backend-only. Only the question of adding policies
  that *allow* future direct client access remains (`architecture.md` →
  Open items). Re-check Supabase's Security Advisor: no RLS findings should
  remain.
- **Agent export format** (JSON vs Markdown vs both, FR-G1): decide when the
  export endpoint is designed.

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

## Session Notes (lessons worth keeping)

- **Branch from `origin/main`**, or `git fetch` first — a branch cut from a
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
- `requirements.md` (v0.3) is the ID source for `D-`, `FR-`, `UC-`, `VR-`,
  `I-`, `OQ-`; it is protected, so spec gaps are logged under Open Questions
  rather than edited.
