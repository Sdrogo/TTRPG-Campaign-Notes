# Progress Tracker

Update this file after every meaningful implementation change. Keep entries
short: a few lines per unit, with the *why* and anything a future session
must know. The full per-unit history (test counts, headless-check logs,
step-by-step notes) is in
[`archive/progress-tracker-full-2026-09-30.md`](archive/progress-tracker-full-2026-09-30.md)
— read it only when you need that detail.

## Current Status (2026-10-02)

Branch `claude/feature-18-qba36q` (spec 18_2, Friends frontend, PR into
`staging`). Frontend **1078** tests at 100% coverage; lint and build clean.
Backend unchanged since 18_1b: 563 tests at 100%. No new migration; all
migrations up to `c4f9a2e7d1b8` (spec 18_1b) are live.

Specs 12 to 18_1b (with direct-invitation decline) are merged into
`staging`. Spec 18 is complete once 18_2 merges; then its browser check.

## Completed Units

Dates are 2026-09 unless noted. Spec files live in `context/feature/`.

### Friends, frontend (spec 18_2, 2026-10-02)

- Account page: a **Room invitations** card (only while some wait:
  Accept/Decline) above Profile, and a **Friends** card under it (friend
  link with Copy and Regenerate, requests received with Accept/Decline,
  Friends with a confirmed Remove, requests sent with Cancel).
- Setup page member table: "Add as Friend" under each other member, or a
  badge (Friend, request sent, request received); hidden if `/friends`
  fails. Invite modal: "Link" and "Friends" tabs; the Friends tab offers
  Friends not already in the Room.
- Header: the account avatar carries a count of requests received plus
  Room invitations (Mantine `Indicator`); its label says how many. No
  real-time: TanStack's refetch on window focus (D-04).
- `/friends/add/:code` (`AddFriendPage`) sends the request once signed in;
  the code survives the sign-in round trip like an invite code
  (`lib/pendingInvite.ts`, its own key).
- **Choices made beyond the ticket**: invitations live on the Account page
  (where the badge leads), not on the Rooms list; the friend link sends the
  request straight away, like an invite link joins; a request to someone
  with no name who shares no Room is confirmed without naming them.
- Hooks `useFriends.ts`, `useInvitations.ts`, shared keys `queryKeys.ts`.
  74 new tests.
### Claude code review replaces CodeRabbit (2026-10-02)

- `claude-code-review.yml` runs `anthropics/claude-code-action` on every
  non-draft PR into `staging`; `claude.yml` answers `@claude` mentions on
  PRs. `.coderabbit.yaml` removed (CodeRabbit trial ended).
- Both need one repository secret, `CLAUDE_CODE_OAUTH_TOKEN`
  (`claude setup-token`, set 2026-10-02) or `ANTHROPIC_API_KEY`. The review
  posts with the job's `GITHUB_TOKEN`, since the Claude GitHub App only
  issues a token when the workflow matches `main`; only `claude.yml` uses
  the App, and it takes effect after the next release to `main`.

### Direct Room invitations, backend (spec 18_1b, 2026-10-02)

- Migration `c4f9a2e7d1b8`: nullable `invitations.invitee_user_id`.
  `POST /rooms/{id}/invitations/direct` (Administrator, accepted Friend,
  not a member), `GET /invitations/mine`; accepting a direct invitation
  reuses `POST /invitations/{code}/accept`, 404 for anyone but the invitee.
  Details in `architecture.md` → Not Room-scoped.
- **Choices made beyond the ticket**: a new direct invitation to the same
  Friend and Room revokes the open one (latest role wins); the sender's
  email follows the Friend rule. Declining (`POST /invitations/{code}/decline`,
  invitee only, never a link) was added after PR #47 at the product owner's
  choice (2026-10-02): it revokes the invitation, silently for the sender.
- 20 new tests (8 domain, 12 API), 563 in all at 100% coverage.

### Friendships, backend (spec 18_1a, 2026-10-02)

- Migration `b7e1d4f8a2c6`: `friendships` (one row per ordered pair, CHECKs
  on order, sender and status) and `friend_codes` (one per user, code
  unique), both RLS + deny policy. Domain `app/domain/friends.py`
  (`plan_request`, `plan_response`, `plan_removal`, `view_for`,
  `plan_friend_code`), repo `app/db/friends_repo.py`, routes
  `app/api/friends.py`. Details in `architecture.md` → Not Room-scoped.
- **Choice made beyond the ticket**: a `hidden_from_sender` column, so the
  sender of a silently declined request can "cancel" it without deleting the
  row (which would end the 30-day cooldown). Re-sending inside the cooldown
  answers like a pending request and asks nobody, so the decline stays
  silent. The recipient of a pending request can't delete it (409): they
  answer it, so a decline always counts.
- Email of a Friend is null unless the two share a Room right now (NFR-03).
- Not audited (no Room). 51 new tests (34 domain, 17 API).

### Characters, frontend (spec 17_2, 2026-10-01)

- Types `Character`, `Document.playedBy`, `Comment.asCharacter`,
  `CommentFormValues.asDocumentId` (undefined = omit, keeps an edited
  Comment's Character). Hooks `useSetDocumentPlayer` (also reloads the
  caller's Characters) and `useMyCharacters`; `lib/characters.ts` maps the
  wire shape and remembers the last "Post as" per Room in `localStorage`
  (guarded, key `postAs:{roomId}`).
- `DocumentPlayer` ("Interpretato da") above the Owners on the detail page:
  single member `Select` + "also make Owner" checkbox (checked by default) +
  unlink, for Owners and the Master; hidden from readers when nobody plays
  it. The Document card adds a "Played by {name}" line with a 20px avatar.
- Composer "Post as" `Select` (yourself + Characters), shown only when the
  caller has at least one; the composer mounts once the Characters load so
  it starts on the remembered choice (dropped if no longer allowed).
- In-character Comment: `CharacterAvatar` (rounded square, not a circle),
  Character name linked to its Document, "interpretato da {author}" with a
  16px user avatar. Editing keeps the current Character selectable even if
  the author no longer plays it, and an unchanged choice is omitted from the
  PATCH so the backend doesn't re-check it.
- Not yet checked in a browser: the Definition of Done walk-through (Master
  links Aria, Player writes as Aria, a member who can't see Aria sees the
  Player's name).

### Characters, backend (spec 17_1, 2026-10-01)

- Migration `a3d9c5e7f210`: `documents.played_by` (user id) and
  `posts.as_document_id` (FK, `SET NULL`). Rules in `app/domain/characters.py`;
  `PUT .../documents/{doc}/player` (Owners + Master, 422 for a non-member,
  audited as `character_player_changed` + `document_owner_added`), Comment
  create/PATCH take `as_document_id` (404 hidden/elsewhere, 403 not yours),
  `GET /rooms/{id}/characters/mine` for the picker. Details in
  `architecture.md` -> Characters.
- `CommentResponse.as_character` is null for a viewer who can't see the
  Character (VR-13). Leaving the Room clears `played_by`; deleting the
  Character keeps its Comments as plain ones.
- Deviation from the ticket: Document responses carry `played_by` as a bare
  user id (like `owner_ids`), not embedded profile fields; 17_2 resolves it
  through the members list.

### PDF Attachments, frontend (spec 16_2, 2026-10-01)

- `components/files/DocumentFileList.tsx` under the text and gallery on the
  Document page: name, size, upload date, Open and Download for every reader
  (VR-12); Upload (`FileButton`, one PDF at a time) for Owners and the
  Master, disabled at 10; delete with a confirm, shown per the backend's
  `can_delete`. Renders nothing for a reader of a Document without files.
- `hooks/useDocumentFiles.ts` (upload multipart, delete) reloads the
  Document, like Notes; `Document.files` comes from the single-Document
  response only. `lib/documentFiles.ts`: wire mapping, client hints (type,
  10 MB; the backend decides by content), size formatting, `openPdf`.
- **Open** fetches the signed link's bytes and shows them from a `blob:` URL
  in a tab opened before the fetch (popup blockers), as the spec says; the
  link itself downloads (`Content-Disposition: attachment`). Not seen in a
  real browser against real Storage yet: check that Supabase's signed link
  answers the `fetch` with CORS, and the layout at phone width.

### PDF Attachments, backend (spec 16_1, 2026-10-01)

- Table `document_files` (migration `e2f7c4a9b1d6`, RLS + deny policy), rules
  in `app/domain/files.py` (by content `%PDF-`, ≤10 MB → 413, ≤10 per
  Document → 409 under the row lock, display name cleaned and cut to 200),
  routes `POST`/`DELETE` in `app/api/document_files.py`, Owners + Master only.
- Files have the Document's visibility (VR-12) and are embedded as `files` in
  every single-Document response, not in the list. Each `url` is a signed link
  with `download=<name>`, so Storage serves `Content-Disposition: attachment`.
- Deleting a Document or a Room queues every file (`remove_files`); the sweep
  treats `document_files.storage_path` as in use.
- `_get_owned_document` moved to `access.get_owned_document` (shared).
- Storage path follows the ticket (`documents/{doc}/files/…`), unlike images
  (`{room}/{doc}/…`). Live Storage behaviour of `download=` is unverified
  (fake Storage in tests): check on the first deploy.

### Leave Room (spec 15, 2026-10-01)

- Every member can leave from the Room card's three-dots menu ("Room actions
  for {name}"), next to Setup and Invite and above the card link. A
  confirmation modal says the user's content stays (D-15) and that coming
  back needs a new invite; an Administrator also sees a hint to name a
  successor in the setup page first. Frontend only.
- `useLeaveRoom` (in `useMembers.ts`) sends `DELETE /rooms/{id}/members/{me}`,
  then removes the Room's queries (they would only 403) and refetches the
  Rooms list. It is separate from `useRemoveMember`, which refetches the
  members list. The last-Master/Administrator `409` text is shown with
  `notifyError` and the modal stays open; the client doesn't re-derive the
  rule. The user id comes from `HomePage`'s session, passed through
  `RoomsPage` to each `RoomCard`.
- Frontend **937/937** tests at **100%** coverage; lint, `tsc`, build clean.
  Not yet seen in a browser.

### API errors follow the UI language (2026-10-01)

- `apiFetch` sends `currentLanguage()` as `Accept-Language` on every request,
  so a user who picked Italian from the flag selector on an English browser
  gets Italian API error text. Frontend only; the backend's `get_locale`
  already reads the header, and `Accept-Language` is a CORS-safelisted
  header, so no CORS change. Frontend **925/925** tests at **100%**
  coverage; lint, `tsc` and `npm run build` clean.

### Claude Code on the web session setup (2026-10-01)

- `.claude/hooks/session-start.sh` (registered in `.claude/settings.json`)
  runs only in Claude Code on the web: installs frontend and backend
  dependencies, starts a local Postgres, applies `tests/ci/supabase_shim.sql`
  on a fresh database and `alembic upgrade head`, and exports CI's env values.
  `DATABASE_URL` is always the local database, so tests never touch the live
  one. Verified on a fresh cluster and on a re-run; lint and sample tests pass.
  The container has Postgres 16 and Node 22 (CI: 17.6 and 24).

### Tests moved to `src/test/` (spec 14, branch `feature/14-tests-folder`)

- All 80 frontend test files moved (`git mv`, history kept) from beside their
  modules to `src/test/`, mirroring the `src/` folders (`src/test/hooks`,
  `src/test/components/setup`, ...); only their relative imports changed.
  Helpers stay at the root of `src/test/`. Rule updated in `code-standards.md`
  -> Testing. No test logic changed: 923/923 pass, 100% coverage, lint and
  `tsc` clean. Open PRs that add or edit a co-located test will conflict and
  need their test moved to the matching `src/test/` path.

### Room and Tag deletion, backend (spec 13_1b, branch `feature/13-1b-room-tag-delete-backend`)

- `DELETE /rooms/{id}` (Administrator only) and `DELETE /rooms/{id}/tags/{tag}`
  (Administrator or Master). Room deletion queues every image of every
  Document for Storage removal before the cascade; Tag deletion rewrites the
  combinations through `plan_tag_removal`. No migration (every FK already
  cascades). Details in `architecture.md` -> Storage Model.
- Tests: `tests/test_room_delete_api.py`, additions to `test_main_items_api.py`
  and `test_domain_tags.py`; `app/` coverage stays 100%. Four tests in
  `test_notes_api.py` fail locally because the live database already holds 7
  `note_visibility_changed` audit rows and they count every row; unrelated to
  this change (CI uses an empty database).
- Assumptions confirmed by the product owner (2026-10-01): Administrator-only
  Room deletion; the Master may delete Tags; Room audit rows go with the Room;
  a combination below two Tags is dropped.
- Next: 13_1c (setup-page controls).
### Invite link survives sign-in (2026-10-01)

- Bug: opening `/invite/:code` signed out, then signing in, logged the user in
  but never joined the Room (OAuth returns to the site origin, so the invite URL
  was lost). Fix: `lib/pendingInvite.ts` keeps the code in `sessionStorage`;
  `AcceptInvitePage` saves it when signed out and clears it on accepting;
  `HomePage` redirects a signed-in user with a saved code to `/invite/:code`.
  `redirectTo` is unchanged, so no Supabase Redirect URLs change is needed.
- Frontend 923 tests, 100% coverage, `tsc` and lint clean. Not seen against
  real Google login: do a live check with a fresh invite link.

### Room card navigation feedback (2026-10-01)

- The Room navigation overlay has a dedicated class with a themed hover
  border and an inset keyboard focus ring, preserving its positioning and
  the Administrator controls above it.

### Nullable Note mutation responses (2026-10-01)

- Create and update mutations accept null when the saved Note is hidden from
  the requester (VR-07), preserving success and Document query invalidation.
  Regression cases cover null responses from both mutations.

### Room card, Room and Tag deletion, frontend (spec 13_1a + 13_1c)

- 13_1a (PR #29): the whole Room card links to its Documents; Setup and Invite
  sit above the link (same overlay pattern as `DocumentCard`).
- 13_1c (branch `feature/13-1c-room-tag-delete-frontend`): setup page gains a
  Tag list with a confirmed delete per Tag (`TagManagement`, `useDeleteTag`)
  and a "Danger zone" that deletes the Room once its name is typed
  (`DeleteRoomSection`, `useDeleteRoom`, then back to `/`). The Tag
  confirmation shows no Document count on purpose (the backend has none that
  respects visibility, VR-07). The Main Tags editor is also re-keyed on the
  Room's Tag ids, so a deleted Tag can't linger in an unsaved draft. Depends
  on the 13_1b endpoints: merge after that PR.
- Not yet seen in a browser: card/button stacking, both modals, the setup page
  after a Tag deletion.

### Note reorder reload (2026-10-01)

- Note mutations return the Document invalidation promise so reordering stays
  pending until the reload finishes; regression cases cover accepted and
  rejected orders.

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

### Tag combinations (spec 11_2, 10-01, PR #25 merged)

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
  Create and PATCH return null when the saved Note is hidden from the caller;
  the Master can still read it, and visibility changes remain audited.
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
- Migration `b5d8f2a9c1e3` **applied to the live DB on 10-01** (with the
  user's go-ahead, before the merge).


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

### Index follows the Main items (spec 11_3, 10-01, branch `feature/11-3-index-follows-main-items`)

- The Glossary/Tag index drawer now opens with the Room's Main items - single
  Tags **and combinations** - instead of only `mainPosition` Tags. Index,
  Documents grouping and setup editor all consume one list:
  `useMainItems` -> `lib/mainItems.ts::resolveMainItems` (ordered, drops items
  with a missing Tag). A combination links to the Documents filtered by all its
  Tags (`?tag=a&tag=b`, AND - the same rule as its group).
- `groupTagsByCategory(tags, items)` now returns `entries: Tag[][]`; a Tag
  that is a *single* Main item is listed only in the first group, one that is
  only inside a combination keeps its category place. Saving on the setup
  page writes the cached list the drawer reads, so it updates without reload.
- Removed the now-dead `isMainTag`/`sortMainTags`; `Tag.mainPosition` is no
  longer read by the UI (the backend still stores it for single items).

### Notes on Documents, frontend (spec 12_2, 10-01, branch `feature/12-2-notes-frontend`)

UI half of `context/feature/12 - add Notes to Documents.md`, on top of the API
from spec 12_1 (a separate PR; this one must merge after it).

A Note is the Detail of D-18 (same feature, two names, confirmed 10-01); it
stays Owner/Master-managed, a deliberate departure from D-19 logged as an Open
Question in the backend PR.

- Each Note the viewer may see is a **paragraph under the Document
  description** on the detail page (`components/notes/NoteList`, `NoteItem`,
  `NoteForm`): a small heading, the text through `MentionText` and, to those
  who can edit, the `VisibilityBadge`. Notes come **embedded in the Document
  response** (`Document.notes`, empty on a Document from the list), so there
  is no second query: `hooks/useNotes.ts` mutations reload that one Document.
- **A hidden Note leaves no trace**: the UI renders exactly what the API sent
  and filters nothing itself. With no Notes and no right to add one, `NoteList`
  renders nothing, so the page looks as before. Controls follow the backend's
  per-Note `can_edit`/`can_delete`; "Add Note" shows for Owners and the Master
  (same rule as editing the description).
- Same `#` logic as the description: `MentionText` to read, `MentionTextarea`
  to edit; a mention of a Document missing from the viewer's list stays plain
  text (VR-07). Title is required (≤200, `MAX_NOTE_TITLE_LENGTH`); the
  description has no limit, like a Document's.
- **Reordering is immediate** (up/down arrows, one `PUT .../order` per click)
  rather than "move then Save" as the ticket suggested: it is cheap and
  reversible, like picking the favorite image. Only the Notes the viewer sees
  are sent; the backend keeps a hidden Note in its slot.
- Checked in a headless browser against a stubbed API and a faked session, as
  Master/Owner and as a plain Player, at 1280px and 390px: add, move, edit,
  delete all issue the right requests, the hidden Note's text never reaches the
  page, no console errors. Not checked: the real backend end to end.

## Room deletion lock ordering (2026-10-01)

- Room deletion locks the Room before locking its Documents and
  snapshotting images. Image cleanup and the cascading deletion keep
  their existing sequence.

## Next Up

- **Browser check of spec 16** (after 16_2 merges and the migration is
  live): upload a character sheet as an Owner, open and download it as
  another member, confirm a member who can't see the Document gets nothing.
  Migration `e2f7c4a9b1d6` is already live.
- **Browser check of spec 17** (after 17_2 merges): the ticket's Definition
  of Done walk-through with a Master, a Player and a member who can't see
  the Character's Document.
- **Browser check of spec 18** (after 18_2 merges): the ticket's Definition
  of Done with two users who met in a Room: Add as Friend, accept, then one
  invites the other to a new Room from the Friends tab and the other joins
  from their Account page. Also open a friend link while signed out.
- **Spec 13 (Room card, Room and Tag deletion)**: 13_1a (clickable Room card,
  branch `feature/13-1a-room-card`) is built and unit-tested; the card link and
  buttons stacking is not yet seen in a browser. Ticket written
  (`context/feature/13_1 - Room Card refinment and Delition for TAGs and
  Rooms.md`), no code yet. Three steps: 13_1a clickable Room card (frontend),
  13_1b `DELETE` Room/Tag (backend; Storage cleanup for every image, Main
  items stay valid), 13_1c setup-page controls (frontend). Open questions are
  listed at the end of the ticket.
- **Merge spec 12_1, then build 12_2** (frontend). Migration `c6e1a4b7d2f9`
  is already live; Render redeploys the backend on merge and the single-Document
  responses gain a `notes` field (additive, the old frontend ignores it).
- **Browser check of spec 12** (after 12_2): create, edit and reorder Notes
  as a Document Owner and Master; confirm Master-only Notes disappear for
  Players while remaining visible to the Master.
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
- **Mention backlinks (spec 20, ticket written 2026-10-02)**:
  `20 - Mention backlinks` (mentions stored with ids, one-off conversion of
  old `#Name` text, "Mentioned in" filtered per viewer). 20_1 backend +
  data migration, then 20_2 frontend. Tags get backlinks too.
- **Full-text search (spec 21, ticket written 2026-10-02)**:
  `21 - Full-text search` (current Room, Documents/Notes/Comments/Tags,
  accent-insensitive prefix match, visibility filtered on the server).
  21_1 backend + migration, then 21_2 frontend.
- **Build order (product owner, 2026-10-02)**: one feature at a time, each
  closed with all its sub-tickets before the next starts: 19 (19_1, 19_2,
  19b, 19c) → 20 → 21 → 22 (with 22b) → 23 (with 23b, 23c) → 24.
- **Threads (spec 19, tickets written 2026-10-02)**: `19 - Threaded replies`
  (nested replies, 3 visible levels, a reply narrowed with its parent but
  its own visibility kept), `19b - Unread replies`, `19c - Reactions,
  mentions, pins and promotion`. All decisions confirmed (2026-10-02); 19's
  Decision 6: the author keeps seeing their reply under a "parent hidden"
  placeholder (VR-02 unchanged). Ready to build, starting with 19_1.
- **Thread pagination (FR-T3)**: not owned by any ticket; 19 loads the
  whole Thread at once. Write a ticket when Threads get long in practice.
- **Reveal and visibility (spec 22, tickets written 2026-10-02)**:
  `22 - Reveal and visibility history` (Reveal on Documents, single Notes
  and Comments with "Revealed" marks and a header count; History tab;
  Room default visibility) and `22b - View as player` (read-only preview
  through an `X-View-As` header).
- **Room export (spec 23, tickets written 2026-10-02)**: `23 - Room
  export` (JSON + Markdown, per-viewer), `23b - Room PDF manual` (TTRPG
  manual layout, first style Gothic, Vampire-inspired, WeasyPrint in a
  background job; check Render can install Pango first), `23c - Agent
  access tokens` (read-only per-Room tokens, FR-G2). 23 and 23c decisions
  still to confirm.
- **Version history (spec 24, ticket written 2026-10-02)**: `24 - Version
  history` (Document name/description and Note text, 10-minute merge per
  editor, Owners + Master compare and restore, all versions kept).
- Decide whether new Rooms should get default Tags in the creator's
  language.

## Open Questions

Items marked *protected* need a product pass because `requirements.md` is a
protected file.

- **Spec 18_1b, Friendship removal and direct invitations**: removing a
  Friendship doesn't revoke direct invitations the two sent each other. Keep
  it, or revoke them on removal?
- **Spec 12 — Notes = Details (decided 2026-10-01, `requirements.md` needs a
  product pass, *protected*)**: the product owner confirmed a Note and a
  Detail (D-18) are the same feature under two names, and chose to keep
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
  page; leaving is **resolved** by spec 15 (Leave in the Room card's menu);
  (b) the Master alone can't set Main Tags (Administrator only,
  matching "Admin of that Room"). Also new: who the "Admin" is when the
  Master isn't one (they are separate flags, D-11).

- **UI language absent from `requirements.md`** (*protected*): add an NFR for
  supported languages and confirm English as fallback.
- **Auth passages in `requirements.md`** (*protected*): FR-A1 lists five
  providers, but UC-01, the section 5 User, NFR-03 and the MoSCoW **Won't**
  row still say Google-only. D-07 (Google preferred) still holds. NFR-03's
  privacy rule (only name, picture, email) applies to every provider.
- **Images spec gap** (*protected*): D-09/FR-D1 say "Image" (singular).
  The 20-per-Document cap and 1920px/WebP output are implementation choices.
- **OQ-09 / OQ-10** have no `D-` number but are implemented (creator =
  Administrator + Master; last-Master/Administrator guard). OQ-11/OQ-12 are
  resolved (D-19, D-20).
- **Comments — choices to confirm**: (a) the author always sees their own
  Comment, so "Master only" = me + the Master; (b) the Master can delete but
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
- `requirements.md` (v0.3) is the ID source for `D-`, `FR-`, `UC-`, `VR-`,
  `I-`, `OQ-`; it is protected, so spec gaps are logged under Open Questions
  rather than edited.
