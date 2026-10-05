# Progress Tracker

Update this file after every meaningful implementation change. Keep entries
short: a few lines per unit, with the *why* and anything a future session
must know. The full per-unit history (test counts, headless-check logs,
step-by-step notes) is in
[`archive/progress-tracker-full-2026-09-30.md`](archive/progress-tracker-full-2026-09-30.md)
— read it only when you need that detail.

## Current Status (2026-10-05)

**Feature 21 (full-text search) is built**: 21_1 and 21_2 in one PR into
`staging`. It carries **migration `c4e9a7f1d3b2`** (the `unaccent`
extension, a text search configuration and generated search vectors with GIN
indexes on `documents`, `document_notes`, `posts`, `tags`), **applied to the
staging database by hand on 2026-10-05** (from a worktree of the PR's branch,
with `.env.staging` loaded; `alembic current` read `c4e9a7f1d3b2`, it was at
`b8d2f6a4c9e1`) and **still pending on production**: apply it there before the
release that ships it. Backend 827
tests, frontend 1359 tests, both at 100% coverage.

Staging released to `main` with PR #73 (specs 20_1/20_2, PRs #68 to #72).
Backend **754** tests at 100% coverage. The live database is at
`b8d2f6a4c9e1` (applied by hand 2026-10-03; `d7b3a9f2c5e8` before it converted
77 texts to `#` tokens, 204 `document_mentions` rows). No pending migrations.

Specs 12 to 20 are merged into `staging` (features 19 and 20 closed). All
Open Questions closed 2026-10-03. Feature 22 started before 21 at the
product owner's request (2026-10-03); 21 (full-text search) is still to do.

**Migration `b8d2f6a4c9e1`** (spec 22_1: `rooms.default_visibility`,
`reveals`, `reveal_recipients`, an `audit_log` index) **applied to the live
database by hand on 2026-10-03**, before the release that ships 22_1 (one
transaction, `alembic_version` updated; checked: RLS + deny policy on both new
tables, existing Rooms at `room`). All of feature 22 (22_1, 22_2, 22b_1,
22b_2) is in PR #86; 22b adds no migration.

**Staging environment (2026-10-04)**: a second Render service deploys
`staging` after CI passes, backed by a **separate Supabase project** (product
owner's choice, 2026-10-04); the staging frontend is the Vercel Preview of
`staging`. Setup and the migration flow for both databases are in
`architecture.md` → Environments. The staging database starts empty and is
brought to head with `alembic upgrade head`.

**Local env files (2026-10-04)**: on the product owner's machine `.env` is
**production**; staging and dev live in `.env.staging` and `.env.dev`. The
backend and Vite only read `.env` by default, so those must be loaded
explicitly (`architecture.md` → Local env files).

## Completed Units

Dates are 2026-09 unless noted. Spec files live in `context/feature/`.

### Room export, frontend (spec 23_2, 2026-10-05)

- An "Export" dialog (`ExportRoomModal`: Markdown or JSON, optional Tag filter,
  a note that links expire) reached from the Room title's "⋮" (every member),
  the setup page header and the preview banner, so the Master can export "as
  player X" (the `X-View-As` header rides along). The file downloads through a
  blob, named `<room>-<date>.json|md`. Details in `architecture.md` → Room
  export → Frontend.
- Choices beyond the ticket (confirm): Markdown is the default format (the
  ticket lists JSON first); the file name is built in the browser instead of
  read from `Content-Disposition`, which would need a CORS `expose_headers`
  change on the backend; no progress or size indicator, the request is one
  GET; `apiFetch` now shares its request code with the new `apiDownload`.
- Not seen in a browser yet: the download itself, the dialog at phone width,
  and the banner with its two buttons.
- Frontend 1379 tests (20 new: file name and path, `apiDownload`, the dialog,
  its three entry points), 100% coverage; `tsc`, lint and build clean.

### Room PDF, layout and styles (spec 23b_1b, 2026-10-05)

- The manual itself, still with no route: `app/domain/manual.py` lays the
  export tree out (cover, one chapter per Main item, a Document printed once
  and referenced as "→ p. N" elsewhere, "Other" last, Notes as sidebars,
  Comments as an optional appendix, index of Tags, mentions as links only when
  their target is in the PDF); `app/pdf/` typesets it (Jinja template per style,
  print CSS, bundled OFL fonts, WeasyPrint). All three styles (Gothic, Modern,
  Print) and both sizes (A4, Letter) are in. Page numbers come from CSS
  (`target-counter`), none from Python. Details in `architecture.md` → Room
  PDF, layout and typesetting.
- Choices beyond the ticket (confirm): a Document with no favorite image uses
  its first; Comment images are left out of the appendix; the page references
  use the PDF's own page numbers (cover = page 1); the Tag filter isn't
  mentioned on the cover; "Contents" is "Indice" and "Index" is "Indice
  analitico" in Italian; the renderer fetches only its own files, `data:` URLs
  and the Manual's image links. `export.group_documents` was split out of the
  Markdown grouping so both formats share it (23's tests unchanged).
- **CI is green on PR #98** (2026-10-05): the PDF smoke tests (three styles,
  A4 and Letter: page count, contents page numbers, "-> p. N", index, accents)
  and the `Room PDF styles render` step in the image pass. **Not looked at
  by eye**: WeasyPrint can't load on the product owner's Windows machine (no
  GTK), so nobody has seen the pages; open a PDF from CI or the image and tune
  the CSS if needed. Found by CI: the floated drop cap in Gothic crashed
  WeasyPrint's float layout on some paragraphs, so Gothic uses a large red
  initial on the line instead (not a true drop cap).
- Still to do: 23b_1c (`export_jobs`, routes, image fetching and downscaling
  through Storage, `pypdf` attachments, 24-hour cleanup), then 23b_2.
- `uv.lock` was regenerated (it lacked `weasyprint`/`pypdf`; the newer uv also
  rewrote its header). `jinja2` is a new dependency, `weasyprint>=70`.
- Backend: 15 layout tests and 16 HTML/asset tests run locally, 7 PDF tests need
  Pango; `app/` coverage is 100% only where Pango exists (CI).

### Room PDF, Docker image and rendering check (spec 23b_1a, 2026-10-05)

- First step of 23b, the deploy check the spec asks for. Decided with the
  product owner (2026-10-05): Render's native runtime can't install Pango, so
  the backend moves to a **Docker image** (`backend/Dockerfile`,
  `.dockerignore`); the PDF itself (23b_1b templates and styles, 23b_1c jobs
  and routes) comes next. `weasyprint` and `pypdf` are now dependencies.
- **Nothing changes in production or staging by merging this**: Render
  ignores the Dockerfile until a service uses the Docker runtime. **Correction
  (2026-10-05): Render does not let you change an existing service's runtime
  from the dashboard** (its changelog says so; only the API or a Blueprint
  can, and which field the API takes is unverified), so the first plan
  ("Settings → Runtime") was wrong. Staging got a **new Docker web service**
  instead: Language Docker, Dockerfile path `backend/Dockerfile`, Docker
  Command empty, the same environment variables as the old staging service
  (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `STORAGE_BUCKET`,
  `CORS_ORIGINS`, `CORS_ORIGIN_REGEX`), at `https://ttrpg-campaign-notes-2.onrender.com`
  (`/health` answers 200). To finish: point the Vercel Preview variable
  `VITE_API_BASE_URL` of the `staging` branch at it and redeploy the
  frontend (Vite inlines it at build time), try the app, then retire the old
  staging service.
- **Production is still open**: a new service means a new URL (the production
  frontend's `VITE_API_BASE_URL`, possibly a custom domain), so decide before
  the release that ships the PDF: new service plus domain swap, or the Render
  API on the existing service (try it on staging first).
- CI: a `Backend image` job (build, import the app, render a PDF inside the
  image, no `.env*` in `/app`) and a rendering test that fails in CI when
  Pango is missing. Not run locally: no Docker and no GTK on the product
  owner's Windows machine, so the test is skipped there; CI is the check.
- The container runs as an unprivileged user (`appuser`), a suggestion from
  the review of the PR; CI checks it and renders the PDF as that user.
- Free-plan note: Docker builds are slower than the native ones and use the
  workspace's build minutes.

### Room export, Markdown escaping (23_3, 2026-10-05)

- Review finding on PR #93: names written into Markdown headings, links, list
  items and bold runs (Room, Tags, Documents, Notes, files, members,
  Characters, mention names) are now escaped and kept on one line
  (`export.py::_md`), so a Document called `A [B]` can't break its link.
  Descriptions and Comment bodies are left as written. The other half of the
  finding, English labels in the Markdown, stays as decided (see below).
  1 new domain test.

### Room export, backend (spec 23_1, 2026-10-05)

- `GET /rooms/{id}/export?format=json|md&tag=…`: the Room as a downloadable
  file, what the requester sees only, built once as a tree
  (`app/domain/export.py`) and rendered as JSON (`schema_version` 1, documented
  by `ExportJson`) or Markdown. Details in `architecture.md` → Room export.
  Closes the Open item "Export format for Agents".
- Choices beyond the ticket (confirm): reactions, pins, reads and Reveal
  history are left out; a Document shows in full under its first Markdown
  group and as a link under the others; Markdown labels are English; JSON
  `description`/`body` are span lists (`text` and `mention`), not strings;
  member names are exported (display name only), never emails; the file's
  link note says "within 60 minutes" because cached signed links keep 15 to
  60 minutes; a mention of a Document the Tag filter left out is plain
  `#Name` in Markdown but keeps its id in JSON.
- No migration. Backend tests: 22 domain + 13 API (dev database), 100% of the
  two new modules. Frontend (23_2) next.

### Full-text search, frontend (spec 21_2, 2026-10-05)

- A search in the top bar of every Room page (a field with its shortcut from
  `md`, a magnifier below), opened by click, `Ctrl+K`/`⌘K` or `/`; a modal
  (full screen on phones) with kind chips and a Tag filter, results grouped
  by kind with the matched words marked, arrow keys and Enter, "show more"
  per kind. A result opens the Document, the Note (`#note-<id>`, new) or the
  Comment (`#comment-<id>`, its branch opened) on its page, or the Documents
  list filtered by the Tag; the target lights up briefly. Details in
  `architecture.md` → Full-text search.
- Choices beyond the ticket: a Mantine `Modal`, since `@mantine/spotlight`
  isn't installed; "show more" narrows the search to that kind (50 results)
  instead of growing the group in place; `Ctrl+K` works from text fields too,
  `/` doesn't.
- Not seen running in a browser yet. Frontend 1359 tests, 100% coverage.

### Full-text search, backend (spec 21_1, 2026-10-05)

- `GET /rooms/{id}/search?q=&kind=&tag=&limit=`: accent- and case-insensitive
  prefix match over Document names and descriptions, Notes, Comments
  (replies included, deleted ones never) and Tag names, ranked, filtered with
  the usual visibility functions before paging, excerpts with highlight
  offsets built from the visible rows only. Mention tokens are indexed by
  name. Details in `architecture.md` → Full-text search.
- Choices beyond the ticket: a text search configuration
  (`public.search_simple_unaccent`) instead of an `f_unaccent` wrapper, so
  `ts_headline` marks "Città" for "citta" too; the Tag filter is AND and
  leaves Tag results out; `limit` (up to 50) backs "show more"; offsets are
  in UTF-16 code units so the browser slices them as is; a Tag of another
  Room in the filter is 404.
- Migration `c4e9a7f1d3b2` (applied to staging 2026-10-05, pending on
  production). Backend 827 tests,
  100% coverage.

### View as a member (specs 22b_1 and 22b_2, 2026-10-03)

- Backend: the `X-View-As` header on a Room's routes answers as the chosen
  member, for the Room's Master only and only for its current members;
  every write carrying it is refused (403). Frontend: "View as" in the Room
  title's "⋮", the preview in the URL (`?as=`), a banner with "Exit" in the
  top bar, a separate query cache, every write control hidden and no visit
  recorded. Details in `architecture.md` → View as a member.
- Choices beyond the ticket: the preview covers the Room's Documents pages
  only (the setup page stays the Master's own); "you" marks still name the
  Master, since only what is visible changes.
- Frontend 1337 tests, backend 807 tests, both 100% coverage.

### Reveal and visibility history, frontend (spec 22_2, 2026-10-03)

- Reveal action and dialog on the Document, each Note and each Comment
  (Master only, hidden on content already at Room level); "Revealed" marks
  on cards, the Document, Notes and Comments; the header badge counts unseen
  Reveals and the Account page lists them; the setup page gained Settings
  and History tabs and the default visibility selector; every create form
  starts at the Room default. Details in `architecture.md` → Reveal,
  visibility history and Room default visibility → Frontend.
- Choices beyond the ticket: a card is marked when anything on its Document
  was revealed, not only the Document; a Master who isn't an Administrator
  now reaches the setup page, History tab only; the Reveal dialog starts on
  "chosen players" with nobody chosen, so nothing is revealed by accident.
- Same PR, backend: a create route stores Selective grants only when the
  resolved level is Selective (review finding on PR #86).
- Frontend 1324 tests, 100% coverage; backend 802 tests, 100% coverage.

### Reveal and visibility history, backend (spec 22_1, 2026-10-03)

- Reveal routes for a Document (with chosen Notes), a Note and a Comment,
  Master only; `GET /reveals/mine` for the badge; the History endpoint
  `GET /rooms/{id}/audit-log` for the Master and Administrators, redacted
  for content the reader can't see; `rooms.default_visibility` used by every
  create route. Details in `architecture.md` → Reveal, visibility history
  and Room default visibility.
- Choices beyond the ticket: opening is recorded by `POST .../read` (which
  now returns what it opened) rather than the Document `GET`; a Master or
  Private level revealed to chosen Players becomes Selective, so the
  Document's Owners gain it too; Document visibility changes are now
  audited (they weren't); recipients count only members who see everything
  around the content.
- Migration `b8d2f6a4c9e1` (pending on the live DB). Backend 800 tests,
  100% coverage.

### Open questions closed (2026-10-03)

Every Open Question was answered by the product owner ("ok" to all 15
proposals, 2026-10-03):

- **Confirmed as built**: Tag combination semantics (11_2: AND, also in the
  single-Tag groups, any Tags, no nesting or names); Comments (author always
  sees their own, Master deletes but doesn't edit others', moderation not
  audited, 10,000 chars); Comment images (inherit visibility, deleted with
  the Comment, Owner/Master remove from the gallery, 4 per Comment, no
  image-only Comments); Document mentions (c)-(e) ((a)-(b) superseded by
  spec 20); Account limits and profile visibility; Notes = Details with
  choices (a)-(f); spec 11: setup page and Main Tags stay Administrator-only.
- **`requirements.md` v0.5** (explicitly approved): D-18, D-19, I-08, I-10,
  FR-D3, FR-T1, FR-T8, FR-T10, UC-18, W-03 follow the Notes model; OQ-09/10
  became D-28/D-29; login lists Google, Discord and GitHub (D-07, glossary, UC-01,
  W-01, NFR-03, MoSCoW); images plural, up to 20 (D-09, FR-D1); new NFR-09
  (English and Italian, English fallback); D-26 and NFR-03 carry the two
  code changes below.
- **Code**: removing an accepted Friendship revokes the open direct
  invitations between the two, both ways (`revoke_direct_between`; the
  invitation route locks the Friendship row). **No other user's email is
  sent any more** (`profile_fields` takes the viewer): members list,
  Friends, invitation senders. Pickers tell same-named members apart by a
  piece of the user id. The fallback name stays the existing unknown-user
  label.
- **Sign-in**: Facebook and X removed from `lib/authProviders.ts` and the
  docs (no app credentials for them; Google, Discord, GitHub work).
- **Supabase**: the Security Advisor shows no RLS findings. `EXECUTE` on
  `public.rls_auto_enable()` (Supabase's auto-RLS event trigger function,
  not in our migrations) was revoked from `public`/`anon`/`authenticated` on
  the live DB by hand. No migration involved.
- Limits that were listed as questions (in-process caches/sweeper, stale
  image URLs) moved to Architecture Decisions as accepted limits.

### Room page and top bar refactor (2026-10-03)

- Andrea: "Create Document" is now a round floating "+" at the bottom right;
  the Room title drops "Documents —" and its filters/settings row starts
  collapsed (open when arriving filtered by `?tag=`); the top bar puts the
  icon-only back arrow before the burger, and the app name is held at the
  exact center by a 3-column grid. axe audit still clean. Frontend only.
- Then: the Room card's actions (setup, invite, leave) at the end of the
  Room title row, folded into a "⋮" that unfolds them (`RoomTitleActions`);
  leaving there navigates back to the Rooms list.
- Then: the page's scrollbar keeps its gutter on every page (so the
  centered title no longer shifts between pages that scroll and pages that
  don't, nor when a modal opens) and only shows, thin and semi-transparent,
  while scrolling or with the pointer at the right edge
  (`useScrollbarReveal`). Checked in headless Chromium with classic
  scrollbars.

### Accessibility audit fixes (2026-10-03)

- Andrea's Vercel toolbar audit flagged small touch targets, skipped heading
  levels and no `main` landmark. Reproduced with axe-core in headless
  Chromium against the app with a mocked API (Room list, Document, Rooms,
  Account, setup): all clean after the fix. Each page now has one `main`
  and one `h1`, headings never skip a level (sizes unchanged via `fz`), and
  Tag links are 24px tall to tap. Frontend only.

### Top bar hides on scroll down (2026-10-03)

- Andrea: the pinned bar should leave room on a phone. It now slides up out
  of view while scrolling down and returns as soon as the scroll turns up
  (`useHeadroom` in `AppHeader`, `data-hidden` + a CSS transform). Frontend
  only.

### Pinned top bar (2026-10-03)

- Andrea: in a long Room the top bar scrolled out of view. `AppHeader` now
  stays pinned to the top on every signed-in page (`.app-header`, sticky,
  page background, `z-index: 100`), and `scroll-padding-top` keeps scroll
  targets below it. Frontend only.

### Document page info panel (2026-10-03)

- Andrea found the Played by, Owner and PDF sections heavy (always-open
  forms at the bottom) and wanted the PDFs under the images; from a mockup
  they chose option A. Those three now sit in a bordered panel under the
  gallery: people as small chips with an ✕, adding through a "+" popover,
  PDFs as compact rows with a "Carica PDF" button. Without images the panel
  takes the image's place on the right, 340px wide from `lg`.
- New `DocumentInfoRow.tsx` (`InfoRow`, `PersonChip`, `AddPopover`);
  `.document-body-images` renamed `.document-body-aside`; the "Nessun PDF"
  text is gone (the row hides for readers). No backend change.

### More card columns on very wide screens (2026-10-03)

- On a 3440px monitor three Document cards were over 1000px wide each, and
  the square image floor made them huge. The list's grid (`.documents-grid`)
  now goes to 4 columns from 1920px, 5 from 2560px and 6 from 3200px.

### Unread dot inside the visibility badge (2026-10-03)

- From Andrea's mockup: a Document card's "not yet read" dot now sits inside
  its visibility badge as one pill (`VisibilityBadge` gained `leftSection`),
  instead of floating to its left. Still only on Documents never opened; the
  unread count keeps its own pill.

### Document page: Tag links, text around the image (2026-10-03)

- The Tags under the Document title are accent links to the filtered
  Documents list, as on the cards. From `lg` the gallery floats right and
  the description and Notes wrap around it, then take the full width below
  it (`.document-body*` in `index.css`). Checked headless at 390 and 2000px.

### Document card image minimum height (2026-10-03)

- On wide screens the restyled cards got short and cropped the image to a
  strip. The image panel now stays at least square (an invisible square
  floor under it), so a wider card is taller. Checked headless at 390, 900,
  1300 and 2000px.

### Document card restyle (2026-10-03)

- From Andrea's prototype: on a Document card with images, the images fill
  the right half edge to edge (cover, top-anchored) and fade into the card
  on their left; the badges sit over the image. Cards without images keep
  the old layout. Supersedes spec 07.1's uncropped framing on the card only
  (`ui-context.md` → Document card). Checked headless at 390, 900 and 1300px;
  frontend 1251 tests at 100% coverage.

### Mention backlinks, frontend (spec 20_2, 2026-10-03)

- `lib/userMentions.ts` became `lib/mentionTokens.ts` and reads `doc`/`tag`
  tokens too (`user` ones only in Comments). The textarea writes tokens for
  picked or created Documents and Tags; `MentionText` shows the current
  name, or the written one as plain text for a hidden or deleted target.
  Old plain `#Name` text renders as before.
- "Menzionato in" (`Backlinks`) on the Document page and on the Documents
  list filtered by one Tag; a Comment entry links to `#comment-<id>`, which
  opens the branches above it and scrolls to it.
- **Choices made beyond the ticket**: the section starts expanded; Note
  entries link to the Document (no Note anchor, the ticket asks only for
  Comments); the excerpt is plain text, as frozen by the backend.

### Mention backlinks, backend (spec 20_1, 2026-10-03)

- `#` mentions are stored as `#[Name](doc:<uuid>)` / `#[Name](tag:<uuid>)`;
  each save cleans them (a link only to the Room's content the writer sees,
  or that the text already linked) and rewrites the source's rows in
  `document_mentions`. `GET .../documents/{id}/backlinks` and
  `GET .../tags/{id}/backlinks` list them, filtered like the sources.
- Migration `d7b3a9f2c5e8` converts old `#Name` text by the browser's rule
  and fills the table; tried up and down on a scratch database. Applied to
  the live DB on 2026-10-03 after release PR #73; the result matched a
  local run of the migration on a copy of the live texts.
- **Choices made beyond the ticket**: one row per target per source (the
  excerpt is around the first mention); a Document mentioning itself is no
  backlink; a writer can't newly link a Document they can't see (keeps the
  answer from revealing it), but keeps links already in the text; two FK
  columns `note_id`/`comment_id` instead of one `source_id`; excerpts are
  frozen at save time, so they show the names as written.

### Promotion, frontend (spec 19c_8, 2026-10-03)

- A "Promuovi" menu in a Comment's meta line ("Nella descrizione", "In un
  nuovo Documento"), shown when the backend's `canPromote` allows it; a
  promoted Comment carries a "Promosso" badge, linked to the new Document
  when the viewer sees it.
- Into the description: the Document's editor opens with the Comment's text
  (mentions as `@Name`) appended as its own paragraph, under a notice; saving
  the description records the promotion. Into a new Document: a modal with
  the creation form prefilled and the Comment's images as checkboxes.
- `lib/promotion.ts` mirrors the backend's widening rule (parents included);
  when anyone would newly read the text, `WideningConfirmModal` names them
  before saving, and the confirmation is sent as `confirm_widening`.
- **Choices made beyond the ticket**: the new Document starts at Room
  visibility for a Room Comment and Private otherwise, so nothing widens by
  default; images are copied by URL import into the new Document, and one
  that fails doesn't stop the promotion (the notice names it); once the
  new Document exists the modal closes whatever follows, so a refused
  promotion can't lead to a duplicate Document on retry; the editor
  scrolls into view; promoting while the description is already being
  edited appends the text to what is being typed, keeping the edits.

### Promotion, backend (spec 19c_7, 2026-10-02)

- Migration `c2f6b8d4e1a7`: nullable `posts.promoted_at`, `promoted_by`,
  `promoted_to`, `promoted_document_id` (SET NULL). Not yet live.
- `app/domain/promotion.py` and `POST .../comments/{id}/promote`
  `{target: description|document, document_id?, confirm_widening}`: records
  the mark and a `comment_promoted` AuditLog row; the text goes through the
  existing description and Document routes.
- **Choices made beyond the ticket**: every promotion is audited, not only
  the widening ones (with `newly_reached_user_ids`, empty when nothing
  widens); the backend refuses an unconfirmed widening (409), so the
  dialog can't be skipped; a reply may be promoted; the new Document must
  be one the promoter manages; promoting again keeps only the latest mark;
  `promoted_document_id` is withheld from a viewer who can't see that
  Document. 15 new tests (9 domain, 6 API).

### @mentions, frontend (spec 19c_6, 2026-10-02)

- `lib/userMentions.ts` parses `@[Name](user:<uuid>)` like the backend and
  maps stored text to what the field shows (`@Name`) and edits back.
- `MentionTextarea` takes `members`: `@` opens the member list (no create
  row), a pick stores the token. `MentionText` takes `members`: a member
  is highlighted under their current name, someone who left reads as
  plain `@Name`. Both are passed only for Comments.
- **Choices made beyond the ticket**: editing inside a mentioned name
  unlinks it (plain text), rather than keeping a half-edited token; the
  field shows the name stored in the token, the rendered body the
  member's current name; the Comment search matches the shown text, not
  the token. With members on, the Comment field is announced as a
  combobox even outside a Room's mention context.

### @mentions, backend (spec 19c_5, 2026-10-02)

- `app/domain/mentions.py`: `find_mentions` reads the token grammar shared
  with spec 20, `<sigil>[Name](<kind>:<uuid>)` (`@` + `user`, `#` + `doc`
  or `tag`, `\` escaping `]` and `\`); `unlink_non_members` turns `@`
  tokens naming a non-member into plain `@Name`.
- Comment create and body edit run the body through it with the Room's
  members; no schema change.
- **Choices made beyond the ticket**: a malformed or mismatched token is
  kept as written rather than rejected; `[` in a name needs no escape; a
  mention of a member who later leaves stays a token until the body is
  next edited (the frontend shows it like any departed member). `#` tokens
  are parsed but not yet checked or stored as links: that is spec 20.
  22 new tests (20 domain, 2 API). Unlinking repeats until the text stops
  changing, since an unescaped name can itself read as a token.

### Pin and resolved, frontend (spec 19c_4, 2026-10-02)

- `Comment` gains `pinnedAt`, `resolvedAt`, `resolvedBy`, `canPin`,
  `canResolve`; `useSetCommentFlag` POSTs/DELETEs `.../pin` or
  `.../resolve` and swaps the returned Comment into the Thread's cache.
- `CommentItem`: "Fissato" and "Risolto" badges (tooltip: who resolved,
  when) and the four text actions, offered per the backend's flags.
- `CommentSection`: pinned branches in a "Commenti fissati" section first
  (`splitPinned`, oldest pin first); `visibleReplies` starts a resolved
  branch closed, and resolving or reopening drops a hand-made open/close.
- **Choices made beyond the ticket**: the toolbar's filters still apply to
  pinned Comments (a search can leave them out), only the sort doesn't; a
  resolved branch keeps its top-level Comment visible and folds only its
  replies, still counting new ones ("N nuove"); actions are text links in
  the meta line like Edit/Delete, since Comments have no menu. Not yet
  checked in a browser: the Definition of Done walk-through. 18 new tests.

### Pin and resolved, backend (spec 19c_3, 2026-10-02)

- Migration `a9e3d7c5b1f8`: nullable `posts.pinned_at`, `resolved_at`,
  `resolved_by`.
- `POST`/`DELETE .../comments/{id}/pin` and `/resolve`, idempotent, return
  the Comment; `CommentResponse` gains `pinned_at`, `resolved_at`,
  `resolved_by`, `can_pin`, `can_resolve`.
- `app/domain/comments.py`: `plan_pin` (Owner or Master, top-level, not
  deleted, max 3 per Document, 403/422/409), `plan_unpin`, `plan_resolve`
  and `plan_reopen` (author, Owner or Master; top-level only),
  `can_pin_comment`, `can_resolve_comment`.
- **Choices made beyond the ticket**: the pin limit counts every pinned
  Comment, including ones the pinner can't see (a 409 can thus hint that a
  hidden pinned Comment exists, nothing more); deleting a Comment unpins it
  but keeps its branch resolved, and a deleted top-level Comment can still
  be resolved or reopened (its replies still form a branch); re-resolving
  keeps who resolved first; pinning and resolving don't touch `updated_at`
  and aren't AuditLogged. 23 new tests (14 domain, 9 API).

### Reactions, frontend (spec 19c_2, 2026-10-02)

- `Comment.reactions` (`emoji`, `count`, `reactedByMe`, `userIds`);
  `useToggleReaction` PUTs/DELETEs `.../reactions/{emoji}` (URL-encoded)
  and swaps the returned Comment into the Thread's cache.
- `CommentReactions.tsx`: `ReactionChips` (click joins or leaves, tooltip
  names who reacted, also on long press) and `AddReaction` (Smiley button,
  popover with the picker, hidden at 20 emoji; re-picking your own emoji
  does nothing). Neither on a deleted placeholder.
- `EmojiPicker` + `lib/emojiPicker.ts`: emoji-mart and its data loaded on
  first open, in their own chunks (77 kB + 429 kB raw), labels in the UI
  language.
- **Choices made beyond the ticket**: emoji-mart without `@emoji-mart/react`
  (its peer range stops at React 18), so the custom element is mounted by
  hand; the picker keeps emoji-mart's own dark theme rather than the app's
  accent, since recoloring it needs raw RGB values outside the Mantine
  tokens. Not yet checked in a browser: the Definition of Done
  walk-through. 15 new tests.

### Reactions, backend (spec 19c_1, 2026-10-02)

- Migration `f4c7a1d9e2b6`: `comment_reactions` (`comment_id`, `user_id`,
  `emoji`, `created_at`), PK on the three, CASCADE from `posts`, RLS + deny.
- `PUT`/`DELETE .../comments/{id}/reactions/{emoji}`, idempotent, return the
  Comment; `CommentResponse.reactions` = `[{emoji, count, reacted_by_me,
  user_ids}]` on every Comment route (list in one extra query).
- `app/domain/reactions.py`: `parse_emoji` (one emoji grapheme, ≤32 bytes,
  422), `ensure_can_react` (409 on a deleted placeholder or a 21st emoji,
  counted under the Comment's row lock), `summarize_reactions`.
- **Choices made beyond the ticket**: emoji are recognized by Unicode's
  Extended_Pictographic ranges plus the emoji sequence grammar, without a
  new dependency, so future emoji pass; stored as sent (no VS16
  normalization, the picker always sends one form). The 32-byte limit
  refuses one emoji, a kiss with two different skin tones (35 bytes).
  Deleting a Comment clears its reactions. A member who leaves keeps their
  reactions, like their Comments. `DELETE` removes only the caller's own,
  the Master included. 43 new tests (35 domain, 8 API).

### Unread replies, frontend (spec 19b_2, 2026-10-02)

- `useDocumentVisit` (hooks/useDocuments.ts): `POST .../read` once the
  Thread has loaded, once per Document per mount; returns
  `previous_read_at` and reloads the Documents list so the card's count goes.
- `CommentSection`/`CommentItem`: a "New" badge on what others posted since
  the previous visit (`isNewComment`); nothing on a first visit.
  `visibleReplies` takes `isNew`: a branch that would hide a new reply starts
  expanded, and a branch closed by hand shows "N new" next to "Show".
- `DocumentCard`: the unread count (labelled "N new comments"), or a "not
  yet read" dot when `unread_count` is null.
- **Choices made beyond the ticket**: the marks use the `read` response's
  `previous_read_at` rather than the Document's `last_read_at`, so a
  refetch on focus can't wipe them mid-visit. Not yet checked in a browser:
  the Definition of Done walk-through. 13 new tests.

### Unread replies, backend (spec 19b_1, 2026-10-02)

- Migration `e8c1f5a3b7d2`: `document_reads` (`user_id`, `document_id`,
  `last_read_at`), PK on the pair, CASCADE from Documents, RLS + deny.
- `POST .../documents/{doc}/read` (404 on a hidden Document) returns
  `{last_read_at, previous_read_at}`. The single-Document response gains
  `last_read_at`; the list gains `unread_count` (`DocumentListItemResponse`).
  `remove_member` drops the member's reads of the Room's Documents.
- `app/domain/reads.py`: `is_unread` (created after the visit, by someone
  else, not deleted) and `unread_counts` (effective visibility of spec 19,
  so hidden posts and replies under a hidden parent never count).
- **Choices made beyond the ticket**: `unread_count` is null for a Document
  never opened (Decision 4's dot); deleted posts never count (a placeholder
  has nothing to read); `read` also returns the previous visit, so the
  page can still mark "New" if it refetches the Document after `read`.
  `comments_repo._comment_from_row` became public (`comment_from_row`) for
  `reads_repo`. 23 new tests (14 domain, 9 API).

### Threaded replies, frontend (spec 19_2, 2026-10-02)

- `Comment.parentId`/`parentHidden`; a new Comment's `parentId` is sent as
  `parent_id`. `lib/comments.ts`: `buildCommentTree` (toolbar picks the top
  level, branches follow, same sort), `topLevelComments` (the "shown of
  total" counter counts them), `visibleReplies` (more than 3 replies start
  collapsed to 2), `replyLevels`/`replyGranteeIds`/`replyStartVisibility`.
- `CommentThread`: three indentation levels (a smaller step on phones),
  deeper replies at level 3 with "in reply to *Name*", Show more / Hide
  replies, the "parent hidden" placeholder. A Reply action on every
  non-deleted Comment opens the composer under it (one at a time), with
  "Post as" like a Comment (D-24).
- **Choices made beyond the ticket**: a reply to someone else's non-Room
  Comment starts Selective to the parent's readers (its author and grantees)
  rather than at the parent's exact level, so the person answered can read
  it; at the same parent level a Master-only or Private reply would hide
  it from them. Answering yourself starts exactly at your Comment's level.
  Filters match top-level Comments only, so a search that hits only a
  reply shows nothing (Decision 3 read literally). "Hide deleted" is the
  exception: it drops a deleted Comment, at any level, only when nothing
  live sits under it, so the placeholder keeps its live replies (FR-T5).
- Not yet checked in a browser: the Definition of Done walk-through and
  the indentation at 390px. 25 new tests.

### Threaded replies, backend (spec 19_1, 2026-10-02)

- Migration `d5b2e8f4a1c7`: nullable `posts.parent_id` (FK `posts.id`,
  CASCADE, index). The ticket says `comments.parent_id`; Comments live in
  `posts`. `POST .../comments` takes `parent_id` (404 missing, foreign or
  hidden parent; 409 deleted parent); every Comment response carries
  `parent_id` and `parent_hidden`. The list stays flat.
- `ensure_not_wider` (422) compares audiences over the Room's members, the
  reply's author left out; checked on create and on edits that change who
  sees the reply, never on body-only edits.
- `is_comment_visible_in_thread`: own visibility and every parent's, the
  author always sees their own. Used by the list, the single-Comment routes
  and the gallery. Details in `architecture.md` -> Threads/Posts -> Replies.
- **Choices made beyond the ticket**: the parent's audience is compared on
  its own visibility, not its effective one (the chain rule narrows the
  reply at read time anyway); `comments_repo.get_comment` and
  `get_comments_by_ids` were folded into `get_comments_with_ancestors`,
  which keeps the "Posts of another kind are absent" rule.
- 38 new tests (32 domain, 6 API). Merged in PR #54; migration applied to
  the live DB on 10-02.

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
### CI job summary formatting (2026-10-02)

- The backend coverage section was a raw `coverage report` dump; both jobs
  now write the same layout from `.github/scripts/`: test counts, a totals
  table, and a collapsible per-file table (backend skips empty
  `__init__.py`). Backend test counts come from `pytest --junitxml`.

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
- 13_1c (merged into `staging`, like 13_1b): setup page gains a
  Tag list with a confirmed delete per Tag (`TagManagement`, `useDeleteTag`)
  and a "Danger zone" that deletes the Room once its name is typed
  (`DeleteRoomSection`, `useDeleteRoom`, then back to `/`). The Tag
  confirmation shows no Document count on purpose (the backend has none that
  respects visibility, VR-07). The Main Tags editor is also re-keyed on the
  Room's Tag ids, so a deleted Tag can't linger in an unsaved draft.
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
- **CORS for Vercel previews**: optional `CORS_ORIGIN_REGEX`. Render keeps
  `[a-z0-9-]+` so branch previews work (decided 2026-10-03, see
  `architecture.md` → CORS).
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

## /health answers HEAD (2026-10-03)

- `GET /health` was GET-only, so uptime monitors sending HEAD got 405 and
  reported the Render backend as down while it was up. The route now accepts
  GET and HEAD (`backend/app/main.py`), with a test for HEAD.

## Next Up

Reorganized with the product owner on 2026-10-03.

- **Browser walk-through** (product owner; built and unit-tested, never
  seen running). One checklist:
  - Spec 12, Notes: create, edit, reorder as an Owner and the Master;
    Master-only Notes disappear for Players.
  - Spec 16, PDF Attachments: upload a character sheet as an Owner, open and
    download it as another member; a member who can't see the Document
    gets nothing.
  - Spec 17, Characters: the ticket's Definition of Done with a Master, a
    Player and a member who can't see the Character's Document.
  - Spec 18, Friends: two users who met in a Room add each other, one
    invites the other to a new Room from the Friends tab, the other joins
    from their Account page; open a friend link while signed out.
  - Spec 20, mention backlinks (deployed and migrated 2026-10-03): tokens render
    as names, "Mentioned in" hides what the viewer can't see.
  - Spec 21, search (once migrated): in a Room with Italian and English
    text, "citta" finds "Città", "dra" finds "Drago", a Tag name finds the
    Tag; a Player never finds a Master-only Document, Note or Comment;
    `Ctrl+K` opens search on every Room page; a Comment result scrolls to it.
  - Sign-in: Google, Discord and GitHub work (confirmed 2026-10-03);
    re-test a brand-new user's first sign-in.
  - UI never seen running: the Document card below `sm`, carousel arrows
    over the card's link overlay, clicking an image opens the Document,
    portrait/landscape framing (spec 07/07.1), the 09-27 header,
    back-button and collapsible controls, the clickable Room card (13_1a),
    the Tag and Room delete modals and the setup page after a Tag deletion
    (13_1c).
  A Playwright script for the parts that can be automated is possible on
  request.
- **Build order (product owner, 2026-10-02, confirmed 2026-10-03)**: one
  feature at a time, each closed with all its sub-tickets: 21 → 22 (with
  22b) → 23 (with 23b, 23c) → 24, then the two small tickets below.
  Features 19 and 20 are done.
  - **Full-text search (spec 21)**: `21 - Full-text search`. **Done**:
    21_1 and 21_2 in one PR into `staging` (2026-10-05), migration
    `c4e9a7f1d3b2` applied to the staging database (2026-10-05), pending on
    production.
  - **Reveal and visibility (spec 22)**: `22 - Reveal and visibility
    history` and `22b - View as player` (read-only preview through an
    `X-View-As` header). **Done**: 22_1, 22_2, 22b_1, 22b_2 all in PR #86,
    merged into `staging` (2026-10-03).
  - **Room export (spec 23)**: `23 - Room export` (JSON + Markdown,
    per-viewer), `23b - Room PDF manual` (WeasyPrint in a background job;
    check Render can install Pango first), `23c - Agent access tokens`
    (FR-G2). The open decisions of 23 and 23c are prepared when their turn
    comes.
  - **Version history (spec 24)**: `24 - Version history`.
  - **Default Tags in the creator's language** (decided 2026-10-03: yes,
    the creator's UI language at creation time). Small ticket, after 24.
  - **Read-only members list for every member** (decided 2026-10-03, spec
    11 follow-up: the setup page stays Administrator-only). Small ticket,
    after 24.
- **Thread pagination (FR-T3)**: parked; feature 19 loads the whole Thread.
  Write a ticket only when Threads get long in practice.

## Open Questions

None. The 15 questions listed here were closed with the product owner on
2026-10-03 (see "Open questions closed" under Completed Units); the spec
changes are in `requirements.md` v0.5.

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
