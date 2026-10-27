# Progress Tracker

Update this file after every meaningful implementation change. Keep entries
short: a few lines per unit, with the *why* and anything a future session
must know. Full per-unit history (test counts, decisions taken while
building, headless-check logs) is archived; read it only when you need that
detail:

- [`archive/progress-tracker-full-2026-10-10.md`](archive/progress-tracker-full-2026-10-10.md):
  everything up to 2026-10-10 (specs 12 to 31).
- [`archive/progress-tracker-full-2026-09-30.md`](archive/progress-tracker-full-2026-09-30.md):
  the original log up to 2026-09-30 (specs 01 to 11).

## Current Status (2026-10-27)

- **Docs aligned with the app** (2026-10-27, product owner's request, docs
  only): `requirements.md` v0.6 adds the Decisions, requirements, rules
  and use cases for everything built while developing (maps, Relational
  links, subtitle, Room image and duplication, export/import/PDF, GDPR,
  twelve languages, landing and Demo; D-30…D-45, FR-M1…M9 and others),
  marks FR-G2 dropped, and records per requirement what is built,
  partial, not built or dropped (§14). `project-overview.md`,
  `architecture.md`, `ui-context.md`, `code-standards.md` and
  `ai-workflow-rules.md` lost their stale Glossary, two-language and
  sidebar wording. Not built from the original plan: Glossary entries
  (FR-N3/N4), draft status (FR-D6), notifications (FR-T9), Thread
  pagination (FR-T3), sealed content (VR-09).

- **Spec 45_3, guided tour** (2026-10-25, no migration, frontend only):
  the Demo opens a 13-card tour of the real pages (Room, Index, Documents,
  Notes and mentions, mention map, Comments, Visibility and Reveal, View
  as, search, both maps, a last card to sign in). Each card lights its
  element (`data-tour` attributes) and dims the rest; Back/Next open the
  step's page; Skip, Escape, "Restart tour" in the banner; landing cards
  link `/demo?step=<id>`. Docked at the bottom on a phone. 12 languages.
  Spec 45 is complete.

- **Spec 45_2, read-only Demo** (2026-10-25, no migration, frontend
  only): "Try the demo" on the landing page opens `/demo`, which turns on a
  per-tab flag and reloads into a sample Room ("The Lost Lighthouse",
  English or Italian) kept in the browser: `apiClient` answers from
  `lib/demo/demoBackend.ts`, nothing reaches the backend, every write is
  refused with a read-only notice. A banner under the header switches the
  view between the Master and two Players (spec 22b's preview, by full page
  load), and has Exit demo and Sign in. Live mention maps, both map kinds,
  search, backlinks and Comments work. No images in the sample yet.
  Next: 45_3 guided tour.

- **Spec 45_1, Landing page and quick navigation** (2026-10-25, PR #237,
  no migration): `/` is a landing page for everyone (what Ex Libris is, six
  feature cards, three steps, sign-in for visitors, "Open my Rooms" once
  signed in), the Rooms list moved to `/rooms`, every "my Rooms" link and
  back arrow follows, "Go to sign in" goes to `/#sign-in`; a sign-in
  started on the page goes on to `/rooms` after the OAuth round trip
  (sessionStorage marker), pending invites and friend links first. The
  header has a burger again (`QuickNavMenu`: Home, My Rooms, a sub-list of
  the user's Rooms). Open Graph tags and `public/og-image.png`. 12
  languages. Next: 45_2 read-only Demo, 45_3 tour.

- **Rebranding to Ex Libris** (2026-10-22, no migration): `app.name` is
  "Ex Libris" in all 12 languages (header, home page), browser title and
  meta description, favicon drawn from the placeholder logo (spiral and
  open book on parchment), FastAPI title, outgoing User-Agents, backend
  package name (`ex-libris-backend`), READMEs and context docs. Kept on
  purpose so nothing breaks: the GitHub repo name, the GHCR image
  `ttrpg-campaign-notes-backend`, the Vercel/Render project URLs in CORS,
  and the `ttrpg.language` / `ttrpg.speech` localStorage keys (renaming
  them would reset every user's language and voice). `requirements.md`
  is titled "Ex Libris" since v0.6 (2026-10-27).

- **Release state** (2026-10-27): everything on `staging` is released to
  `main` with release PR #246 (landing, Demo and tour, back fixes,
  dependency bump, compact Room setup and Document form, and these docs;
  conflicts with Dependabot bumps on `main` fixed by #247). No migration
  was needed: production was already at head. Features 01 to 45 are built except 27b (listed under Next Up); 23c, 25
  and 25b were dropped by the product owner.
- **Latest work**: spec 31 (GDPR: `GET /account/export`, `DELETE /account`,
  public `/privacy` notice, PR #150, controller named in PR #152) and spec
  30/30b (read aloud with the browser's voices, best installed voice by
  default, first reading waits for the voice list, PRs #146, #148, #154).
  Neither has a migration.
- **Spec 43, Real-time map editing** (2026-10-24, PR #229, no migration):
  map saves send only what changed (`PATCH .../board`, `PATCH .../geo`),
  laid over the stored board, so editors no longer overwrite each other and
  spec 42's 412 reload is gone from the page; an open map is read again every
  5 s and the editor's unsaved changes are laid over it, never under a drag.
  Push, presence and phone editing not built (product owner, 2026-10-24).
- **Spec 42, Maps editable by players** (2026-10-24, PR #230, migration
  `e2b7c4f9a1d6`): a switch in a free or geographic map's settings ("I
  Player possono modificare la mappa", off by default) lets every member who
  sees the map edit its board; settings, deletion, plane, background and
  linking stay with its creator and the Master. Every map write raises
  `relationship_maps.revision`; a board save based on an older revision is
  412 and the page reloads the map, telling the editor to redo the last
  change. Real-time merging/live updates: analysed (Claude Doc "Modifica
  delle mappe in tempo reale"), product owner chose the guard only
  (2026-10-24). Defaults in the spec's Decisions to confirm in the PR.
  Applied to staging and to production 2026-10-24 (production with
  `backend/.env` loaded, product owner's go-ahead), so the `staging` →
  `main` release that ships spec 42 can be merged.
- **Spec 41, Relational link Notes** (2026-10-21, migration
  `a4d9e2c7f1b6`): a Note can be flagged as a Relational link (switch in
  the Note form, badge next to its title for every reader), and **only the
  mentions written in flagged Notes** feed mention maps (product owner's
  choice, 2026-10-21): descriptions, unflagged Notes and Comments no longer
  draw relations there, so existing mention maps are empty until a Note is
  flagged. "Mentioned in", search and the rest still see every mention.
  Room duplication keeps the flag; the JSON export does not carry it.
- **Spec 36, Mention map** (2026-10-14, PR #188, migration
  `c6e2a9f4d8b3`): a live map per Document of the Documents it mentions or
  is mentioned by, depth 0 to 3 picked in a modal, computed from the visible
  mentions on every read and drawn under the Document's images; full screen
  page to move and recolor cards, copy as a free map. Built (36_1 backend,
  36_2 frontend); *proposed* decisions in the spec to confirm in the PR.
- **Mention map preview loading** (36_2 follow-up, 2026-10-14, PR #189): the
  modal shows a labelled loader while the preview loads, and the preview is
  not retried, so an error shows at once; before, the Create button just
  looked disabled (seen on staging while the backend had not deployed yet).
- **Mention map: only ties to the center, compact layout** (36 follow-up,
  2026-10-14, product owner after a real Room): the map draws only the
  relation tying each card to the card that brought it in (the center on
  the first ring), no cross relations; the first ring is packed in
  concentric rings one card apart instead of four fixed 90° sectors. No
  migration; saved card positions keep winning.
- **Room PDF: a Document that fits one column stays in one** (2026-10-19,
  product owner with before/after pages, no migration, every style): instead
  of balancing a short Document across both columns (name and image left,
  text right), it is set whole in the left column with the column rule at
  its right; the next Document that also fits takes the right column, else
  it stays empty. Longer Documents keep the two balanced columns. Costs one
  more layout (a measuring one, every Document alone in one column).
  Details in `architecture.md` → Typesetting.
- **Spec 35, Parchment PDF style** (2026-10-13, no migration): a fourth
  Room PDF style, `parchment`, modeled on a fantasy monster compendium the
  product owner shared: parchment-colored pages, brown small-capital
  headings, ochre rules, the subtitle as a stat-block band. Only existing
  fonts (Crimson Text, PT Serif, Noto CJK). Defaults to confirm in the PR.
- **Spec 32, mention hover preview** (2026-10-12, PR #157, frontend only,
  no migration): on the Document page, resting a mouse on a linked
  `#Document` mention for 400 ms shows that Document's `DocumentCard`
  (`DocumentMentionPreview`, a Mantine `HoverCard`). It reuses the Document
  the mention resolved against (the viewer's filtered list): no request, no
  hidden Document revealed. Nothing on touch screens or for Tag mentions.
  Decisions to confirm in the PR.
- **Spec 31, still owed by the product owner**: legal review of the
  `/privacy` notice and the DPAs with Supabase, OVHcloud and Vercel. It
  shipped to production with the 2026-10-09/10 releases before those were
  done. Keeping shared content anonymised after an account deletion is the
  default in place, not explicitly confirmed. Any new table that stores a
  user id must be added to `account_repo.erase_personal_rows`
  (`architecture.md` → Personal data).
- **Test baseline**: backend and frontend both at 100% coverage with exact
  CI gates; `ruff`, `mypy`, `tsc`, lint and build clean.

## Migrations and Releases

Alembic migrations are **not** applied on deploy: the product owner applies
them by hand (`alembic upgrade head` with the matching env file loaded,
`architecture.md` → Local env files and → Environments). Staging gets a
migration before its PR merges into `staging`; production gets it before the
release to `main` that ships it. Before any release, list what is pending
here and remind the product owner.

- **Head in the repository**: `b5f1d8e3a7c2` (`rooms.maps_position`, maps row
  placed among the Grouping items, PR #236, merged into `staging`; applied to
  the staging and production DBs).
- **Staging database**: `b5f1d8e3a7c2` (= head, room maps_position, PR #236,
  applied by hand 2026-10-25 with `.env.staging` loaded, before the PR
  merges); `e2b7c4f9a1d6` before it (map players_can_edit and
  revision, spec 42, applied by hand 2026-10-24 before PR #230 merged);
  `a4d9e2c7f1b6` before that (note relational link, applied
  by hand 2026-10-21 with `.env.staging` loaded, before PR #222 merged);
  `d7c1f5a9e3b8` before it (geographic maps, applied 2026-10-17;
  `e8b4d2f6a9c1` before that, document linked maps, applied 2026-10-15; `c6e2a9f4d8b3` before it,
  mention maps, applied 2026-10-14; `b4d8f2a6c1e7` before it, applied
  2026-10-13, `a9e3c5d7b1f4` the same day, and `d5a1c8e3f2b7` on 2026-10-12).
- **Production database**: `b5f1d8e3a7c2` (= head, room maps_position, PR #236,
  applied 2026-10-25 with `backend/.env` loaded, ahead of the release that
  ships it). Before it, `e2b7c4f9a1d6` (map players_can_edit and revision,
  spec 42, applied 2026-10-24). Before it, `a4d9e2c7f1b6`, applied 2026-10-21 with
  `backend/.env` loaded (note relational link, spec 41), ahead
  of release PR #223 (staging to `main`), so until that merges production's
  code does not carry the migration file. Before it, applied 2026-10-19:
  `d7c1f5a9e3b8` (geographic
  maps), from `e8b4d2f6a9c1` (document linked maps, applied 2026-10-15, from
  `c6e2a9f4d8b3`, mention maps, applied the same day). Before it, on
  2026-10-13: `a9e3c5d7b1f4` (map label positions) and `b4d8f2a6c1e7` (map
  label offsets), from `d5a1c8e3f2b7` (map card image, applied earlier).
- **Pending on production**: none (the database is at head).

Recent chain, newest first (where each came from):
`b5f1d8e3a7c2` room maps_position (maps row, PR #236) ← `e2b7c4f9a1d6` map players_can_edit and revision (42_1) ← `a4d9e2c7f1b6` note relational link (41_1) ← `d7c1f5a9e3b8` geographic maps (38_1) ← `e8b4d2f6a9c1` document linked maps (36 Decision 15) ← `c6e2a9f4d8b3` mention maps (36_1) ← `b4d8f2a6c1e7` map label offsets (28_3) ← `a9e3c5d7b1f4` map label positions (28_3) ← `d5a1c8e3f2b7` map card image ← `b3f7d1e9c5a2` relationship maps (28_1) ← `a8c4e2f6b1d3` Document subtitle
(28_0) ← `f7a2d8c4e1b9` import jobs (27_2) ← `e9b4c2d7a1f6` `rooms.image_path` (26)
← `c7d3e9a1f5b2` whole-Document history (24b, folds `note_versions` into
`document_versions.notes`) ← `a2e6c9f4b8d1` version history (24_1) ←
`d9a4f1c7e3b5` export jobs (23b_1c) ← `c4e9a7f1d3b2` full-text search (21_1,
`unaccent` + search vectors) ← `b8d2f6a4c9e1` Reveals and Room default
visibility (22_1) ← `d7b3a9f2c5e8` mention tokens (20_1).

Lesson: a release on 2026-10-02 shipped with an unapplied migration
(`f4c7a1d9e2b6`) and broke Comments in production.

## Environments (summary)

Details in `architecture.md` → Environments and `vps-migration-plan.md` §12.

- **Production**: backend on an OVHcloud VPS (`api.exlibris.world`, Docker
  image from GHCR, deployed by `.github/workflows/deploy-prod.yml` after CI
  on `main`, Caddy for HTTPS; cutover 2026-10-08). Frontend on Vercel at
  `exlibris.world` / `www.exlibris.world`. Render production is suspended,
  kept for rollback. DB pool capped at 5 + 2 per process (`DB_POOL_SIZE`,
  `DB_MAX_OVERFLOW`) because Supabase's Session Pooler allows 15 clients.
  The deploy health check calls `api.exlibris.world` with `curl --resolve`
  at the VPS's IP.
- **Staging**: Render Docker service (`ttrpg-campaign-notes-2.onrender.com`)
  deployed from `staging` after CI, Vercel Preview of `staging`, its own
  Supabase project. `.env.dev` and `.env.staging` point at the same staging
  project.
- **Local env files**: `.env` is **production**; `.env.staging` and
  `.env.dev` must be loaded explicitly (`architecture.md` → Local env files).
- The Room PDF needs the Docker image (WeasyPrint + Pango). WeasyPrint does
  not run on the product owner's Windows machine, so CI and the image are the
  only places PDFs render.

## Completed Units

One line per unit; dates 2026, newest first. Spec files live in
`context/feature/`; details in the archives above and in `architecture.md`.

### 2026-10-26

- **Compact Room setup** (Andrea, frontend only, no migration): on the
  Settings tab, Members and the Room image + default visibility are two
  bordered `Paper` cards side by side from `lg` (half each, equal
  height), stacked below. The Tags parts (Grouping, All Tags) went from
  5/12 + 7/12 to half each, so all four cards share one width.
- **Compact Document edit form** (Andrea, frontend only, no migration):
  in the Document edit form, Visibility, Tags and New tag (+ Add) share
  one row from `md` (3/5/4 of 12; Tags takes 9 when the viewer can't
  create Tags), stacked below. `DocumentFields` gets an `inlineMeta`
  prop that only `DocumentEditForm` sets; the create and comment-promotion
  modals keep the stacked layout. Save / Cancel / Delete stay on their row.

### 2026-10-25

- **Back arrow fixes** (Andrea, frontend only, no migration): Room setup's
  parent is now the Room page (it went to the Rooms list); a Room card's
  "Setup" carries the Rooms list as origin. The Room page's Maps row, Maps
  icon, the Room Index map links and the Maps page cards carry their page as
  origin, so back from a map returns there instead of the Maps page. The
  `{ from }` state became a trail (`from` + `backStack`, max 20) walked by
  `useHierarchicalBack`, which reads each Document/map afresh and skips it
  on a 404, so a deleted one never shows its empty state.

- **Maps row on the Room page** (no spec, Andrea's request, PR #236;
  migration `b5f1d8e3a7c2`): `RoomMapsStrip` under the Room title lists the maps the
  viewer sees as small cards (kind + Document count; they wrap, one per row on a phone;
  "All maps (N)" → Maps page). Its "Maps" heading folds it with a caret like a
  Document group (starts open, not remembered; follow-up PR). With none, "New map" for who may create opens the dialog via `?new=1`.
  Administrators place the row among the setup's Grouping items (a "Maps
  row" entry moved like them, never removed): `rooms.maps_position` (Main
  items before it, 0 = top; migration `b5f1d8e3a7c2`), saved through
  `PATCH /rooms/{id}`. Grouped by Main Tag, the row sits before the first
  group placed after it (past the last item, still before "No Main Tag");
  ungrouped, on top. Duplication copies it; JSON export/import does not.
- **Spec 44, Room Index tab** (PR #235, frontend only, no migration):
  the header's burger is gone; every Room page has a tab on the left edge
  (`RoomIndex`, replacing `GlossaryIndexDrawer`) that opens a card narrow in
  width and as tall as the screen (product owner, 2026-10-25), with the
  same Tag sections as before plus a Maps section ("All maps", then every
  visible map, alphabetical). Its strings moved from hardcoded Italian to
  the `glossary.*` keys in all 12 languages (title now "Room Index").
- **Compact Note form** (no migration): Visibility and the Relational link
  switch share one row in `NoteForm`; on a phone the switch's hint sits
  under the row and the form's gaps tighten.

### 2026-10-24

- **43_1, 43_2 Real-time map editing** (PR #229, no migration): per-item
  saves (backend merge + `PATCH` routes, frontend diff/rebase autosave) and
  a 5 s refresh of the open map.

### 2026-10-22

- **Maps on phones** (frontend only, no migration, product owner's
  request): on a map page the name, description and buttons no longer share
  a no-wrap row, so the description takes the full width (buttons on their
  own row under the name on a phone); a geographic map pans and zooms with a
  two-finger pinch, and on a phone its board is no taller than the plane
  across the screen, so it opens filled with no empty bands. Then, at the
  product owner's request: the map's buttons are grouped in a ⋮ menu beside
  the name (one line, cut short), the description is cut to two lines and a
  tap opens or closes it, and on a phone a Document picked on any map opens
  in the lower half of the screen under the map (spec 37 Decision 5 changed).

### 2026-10-21

- **Room PDF without `#`** (no migration, product owner's request): Tag
  mentions, mentions of Documents the PDF doesn't hold and plain `#Name`
  text print as the bare name in every style (`app/domain/manual.py`);
  member mentions keep their `@`. Spec 23b Decision 3 updated.

### 2026-10-19

- **40, Maps in Room duplication and export/import** (no migration): spec
  `context/feature/40 - Maps in Room duplication and import-export.md`,
  product owner's request. Duplicating a Room copies its maps; a Room's JSON
  export (`schema_version` 3) carries the maps the requester sees, and the
  import previews them with a tick, re-points them to the imported Documents
  and leaves out what points elsewhere. Defaults proposed by Claude, all
  confirmed by the product owner the same day.
- **38b, Geographic map reading mode** (frontend only, no migration):
  product owner's feedback after the Shibuya test. A click on a Document's
  area or pin opens it in the split pane (no more card with "Apri il
  Documento"); the map opens for reading and its managers press "Modifica
  la mappa" to get the tools ("Fine modifiche" to leave); area names move
  off pins, pin names and link labels (`placeAreaLabels` in
  `lib/geoMaps.ts`). Notes in the spec 38 ticket.
- **39, Generate mentions** (no migration): spec `context/feature/39 -
  Generate mentions.md`, product owner's request. A "Genera menzioni"
  button on a Document (Owners, Master) and on the Room (every member,
  their managed Documents) proposes the names of visible Documents found as
  plain words, previewed with per-match opt-out, then applied as normal
  edits. Product owner, same day: saving a description or Note links the
  Document names it added by itself (Decision 10), and Tags are never
  linked or proposed. Other defaults picked by Claude, to confirm in the PR.
- **Fix: mention preview carousel** (frontend only): on a wide screen a click
  inside a `#Document` mention's hover preview (spec 32), such as its image
  carousel arrows, opened the mention's half-screen menu (spec 37), because
  React bubbles portal clicks to the mention. The preview's dropdown now marks
  its clicks as its own (`OWN_CLICKS_ATTRIBUTE`) and `DocumentOpenMenu`
  ignores them.
- **30 follow-up, read aloud without `#`**: plain `#Name` mentions (pre-id,
  spec 20) that match a visible Document or Tag are read without the `#`;
  tokens read under the current name. `mentionsToSpeech` takes the Room's
  Documents and Tags from `useDocumentMentions`. Frontend only, no migration.

### 2026-10-17

- **38_1, Geographic maps backend** (migration `d7c1f5a9e3b8`, PR #210):
  spec `context/feature/38 - Geographic maps.md`, chosen by the product
  owner on a decision card (a real geographic map, not a background under
  cards). A map gets `kind` (`free` | `geographic`), a plane and an optional
  background image; areas, pins and links in their own tables, bound to
  Documents or plain, with the spec 28 visibility rules. Routes
  `GET/PUT /rooms/{id}/maps/{map}/geo` and `/background` (upload, from URL,
  delete); the free-board routes answer 409 for a geographic map and back.
  `requirements.md` brought geographic maps into scope in v0.6
  (2026-10-27, D-32).
- **38_2, Geographic maps viewer and editor** (no migration): the product
  owner asked for it before the import ("no import without a way to see
  the map"). "Nuova mappa" offers Free board / Geographic map; the map page
  draws the plane (background, areas, pins, curved links) in an SVG of its
  own with pan and zoom, a card per clicked place (its Document, or its
  note), the split pane for Documents, and a Tag filter for everyone. Its
  managers draw areas corner by corner, place pins, link two items, drag
  pins, areas, corners and a link's curve, and set the plane size and
  background in a "Mappa" dialog (upload or URL; image search not wired).
  Linking a geographic map to a Document now works (the 409 is gone).
- **38_3, Geographic maps import and export** (no migration): the Maps list
  has "Importa mappa": pick the JSON file (the ticket's format, e.g. made by
  Claude in another chat), see the report (counts, names kept as plain
  labels because no visible Document has them, several do, or the Document
  is already on the map), adjust name, description and visibility, import.
  A geographic map's header has "Esporta la mappa (JSON)", the same format
  built from what the viewer sees. Routes `POST /maps/import/preview`,
  `POST /maps/import`, `GET /maps/{map}/export`. The ticket's example file
  imports in a backend test.

### 2026-10-16

- **Spellcheck on text fields** (no migration): content fields (Document
  name/subtitle/description, Note title/body, Comment composer, Map and Card
  text, Arrow label, profile bio) now set `spellCheck` explicitly, so Firefox
  also checks the single-line ones. The dictionary language is `<html lang>`,
  which already follows the App language (`i18n/index.ts`). Not done: a
  per-Room writing language, and any LanguageTool/Hunspell option.
- **Room PDF, real cause found** (no migration): the prod logs showed the
  upload to Storage refused with 413 `EntityTooLarge`: the `document-images`
  bucket has a 10 MB per-object limit and a big Room's PDF is larger. Earlier
  fixes (#198, #204) were real but not the cause. Andrea must raise the bucket
  limit to 50 MB by hand (prod and staging). In code: images capped at 900 px
  and JPEG quality 75, and the PDF Attachments budget is what is left under
  `MAX_EXPORT_BYTES` (48 MB) after the manual itself.

### 2026-10-15

- **Room PDF, second fix** (no migration; PR #198 was not enough on the VPS):
  profiling showed the CPU is WeasyPrint's text layout (pure Python, ~0.05-0.1 s
  per page, run 3 times for page sharing plus its own repaginations), not the
  image conversion (~0.1 s per image, off the GIL). In a thread it held the GIL
  for minutes and starved the API (status polls every 3 s, health check). The
  render now runs in a low-priority child process, so the API stays responsive
  and an OOM kill fails only the job; images are capped at 1000 px instead of
  1400. A shared WeasyPrint image cache across the layouts was tried and gave
  nothing. Stored WebP can't go in a PDF as is, hence the JPEG conversion.

- **Existing map linked unchanged** (spec 36 Decision 15, no migration,
  Andrea: "use that Map unchanged"): picking an existing map in the
  Mentions map modal only links it to the Document (`PUT
  /rooms/{id}/documents/{doc}/linked-map` `{map_id}`); the old
  `POST .../mention-map/add-to-map`, which copied Documents and relations
  into the map, is removed. The modal hides depth and preview for it.

- **Hierarchical back** (Andrea: browser history made Back unreliable
  around maps and the split view): the header's back arrow no longer calls
  `navigate(-1)`. It goes to the page's fixed parent (Document -> Room ->
  Rooms list, map -> maps list), or to the page it was opened from when the
  link says so (`lib/backNav.ts`: `useBackState`/`backDestination`, state
  `{ from }` put by map-card Document links, the open menu's "open page",
  the linked/mention map panels and the "copy as free map" redirect). It
  replaces the current entry, and opening/closing the `?side=` pane now
  replaces too, so the browser's Back leaves the page instead of stepping
  through pane changes. Frontend only, no migration.
- **Linked map on the Document page** (spec 36 Decision 15, migration
  `e8b4d2f6a9c1`, Andrea: the map picked must be added to the Document):
  "Add to map" now also links the map to the Document (one per Document,
  `document_linked_maps`) and stays on the page, where `LinkedMapPanel`
  draws it under the images; its managers can unlink it. Routes `GET` /
  `DELETE /rooms/{id}/documents/{doc}/linked-map`.

- **Room PDF fails on a Room with many Documents** (bug fix, no migration):
  the job embedded every image as a base64 `data:` URL, so the HTML and
  WeasyPrint's parsed copy (three layouts) held them several times over: in a
  repro ~100 images took over 1 GB of RAM (415 MB with files), enough for the
  OOM killer on the 4 GB VPS; the container restarts and the startup sweep
  marks the job `interrupted`, which is why Network showed nothing. Now each
  image is a JPEG file in a per-job temp folder (`file:` URLs allowed only
  inside it). `STALE_AFTER` also went from 30 minutes to 2 hours so a long
  render of a big Room isn't failed while it runs.

- **Mention map into an existing map** (spec 36 Decision 15, no migration,
  Andrea's request): the "Mentions map" modal lets whoever manages free
  maps pick one instead of a new mention map; "Add to map" adds the
  Documents and relations at the chosen depth once (cards already there
  stay, relations already drawn are not repeated) and opens the map. New
  route `POST /rooms/{id}/documents/{doc}/mention-map/add-to-map`; new keys
  `maps.mention.target*` and `addToMap` in all 12 languages.

- **Route code splitting** (frontend only, no migration): Vercel warned the entry
  chunk was 1,665 kB. Every page except `HomePage` is now `React.lazy` in
  `App.tsx` (one `Suspense`), so the entry chunk is about 315 kB and no chunk
  is over 500 kB; the warning limit is untouched. `App.test.tsx` awaits the
  lazy pages with `findByText`.
- **Mobile Document header, Note actions and icon labels** (frontend only, no
  migration): the Document's actions and each Note's actions are folded into a
  "⋮" on every screen size (uniform, Andrea). On a big screen they unfold in place beside it;
  below `sm` they unfold on a row under the header, and the name, the visibility
  badge (icon only there, `VisibilityBadge compact`, level as tooltip) and the
  read-aloud controls share one line, the name wrapping to two lines but always visible.
  Every icon-only button shows its label as a tooltip on hover or long-press:
  `LabeledActionIcon` wraps `ActionIcon` + `Tooltip` using the `aria-label`. New keys
  `documents.detail.actions` and `notes.actions` in all 12 languages.

### 2026-10-16

- **37 rework, maps split by button** (no migration, into `staging`): the map
  card hover preview and the card open menu are removed. Relationship and
  mention map pages get a split toggle button; the right pane follows the
  selected Document card. `?side=` with no value means open with nothing
  picked. Menu/`?side=` on the Document page and the Documents page are
  unchanged. Spec 37 gets a "Rework on maps" section that supersedes the map parts of Decisions 1 and 2.

### 2026-10-14

- **37, Document preview and split view** (no migration, PR #190 into
  `staging`): map cards preview their Document on hover; a click menu
  ("Apri a metà schermo" / "Apri il Documento") on map cards (from the name
  while editing, the whole card read-only), `#Document` mentions on the
  Document page and in the Documents page's cards; `?side=<id>` splits any
  Room page (`PageLayout` → `SplitView`, width in `localStorage`), the right
  pane is the full `DocumentView`. Not below `sm`.
- **36 follow-up** (PR #190): mention maps draw only each card's tie to its
  parent, on tightly packed rings.

### 2026-10-13

- **Mentions block compact** (no migration): "Mentioned in" is collapsed by
  default on the Document page and on the Tag-filtered Room list, where it
  now sits after the results; vertical padding `md` open, `xs` collapsed.

### 2026-10-12

- **More UI languages, 34_3** (spec 34, 10-12, no migration): ja, ko and
  zh-Hans (Simplified, Mainland wording), frontend and backend files drafted
  by Claude, "beta" in the selector; flags (jp, kr, cn), emoji-mart labels
  (`ja`, `ko`, `zh`), read-aloud tags `ja-JP`, `ko-KR`, `zh-CN`. The Room PDF
  gets Noto Serif and Sans subsets for each script (about 4,000 to 5,000
  glyphs, `.woff`, 10 MB in all) as per-glyph fallbacks in every style, so
  CJK content renders whatever the page language; `:lang(zh)` and `:lang(ko)`
  put their own Han glyphs first, and for CJK pages the Gothic drop cap,
  hyphenation and synthesized bold/italic are off. Tests: the font-coverage
  test now includes the three scripts, and a new one checks the page
  language picks the right script's face. Also: the privacy intro of every
  non-Italian/English language now says the Italian and English texts prevail
  (spec 34 Decision 10; it was missing in 34_2). Open for a native check: 開示,
  揭示 and 공개 for "Reveal", 룸 vs 방 for Room. `zh-Hant` stays later.
- **Mention preview nesting fix** (10-12, PR #172, frontend only):
  `MentionText` renders its root as a `div` (not Mantine's `<p>`) so the
  hover preview card (headings, divs, paragraphs) nests validly; a test
  guards the root element.
- **More UI languages, 34_2** (spec 34, 10-12, no migration): de, es, fr, nl,
  pl, pt-PT and ru, frontend and backend files drafted by Claude and shown
  as "beta" in the selector; simplified flags; lazy-loaded; the selector
  lists languages from `LANGUAGE_NAMES` (their files aren't loaded until
  picked); emoji-mart labels and read-aloud tags for each; PT Serif
  bundled as the Cyrillic fallback of the Gothic and Print PDFs (Lato already
  has Cyrillic); a PDF test fails if any style falls back to a system font
  for Cyrillic or Latin Extended text. Glossary filled. Next: 34_3, East
  Asia (ja, zh-Hans, ko) with CJK fonts.
- **More UI languages, 34_1 foundations** (spec 34, 10-12, no migration, no
  new language yet): `resolveLanguage` / `resolve_locale` map regional and
  script tags (`pt-BR` → `pt-PT`, `zh-TW` → `zh-Hans` until `zh-Hant` exists)
  with the same alias table on both sides; non-bundled languages load
  lazily (`LAZY_LOADERS`, `ensureLanguageLoaded`, `i18nReady` holds the first
  render, a failed switch shows `language.loadFailed`); `locales.test.ts`
  compares plural keys as groups per `Intl.PluralRules` (Russian four forms,
  Japanese one); `context/i18n-glossary.md` started. Next: 34_2.

- **Parallel line-only relations** (28 follow-up, 10-13, frontend only, no migration): several "Line only" relations between the same two cards are drawn side by side (`parallelShift` in `lib/maps.ts`, `MapArrow`), metro-map style; backend and DB never restricted duplicates.
- **More relation colors** (28 follow-up, 10-13, frontend + backend enum, no migration): 11 colors added to the map palette (orange, midnight blue, silver, gold, light pink, pink, blue, purple, emerald, brown, light green); picker shows one row with a "more colors" toggle; old labels renamed Fuchsia / Light blue / Yellow in all 12 languages.
- **Map cards easier to move and select** (28 follow-up, 10-12, frontend
  only, no migration): cards get a grab cursor, a hover ring and a grip
  mark; dragging on empty canvas now draws a selection box (partial overlap)
  and the board pans with the middle/right button or Space. Selection drags
  are saved through `onSelectionDragStop`.
- **Map card images and no label suggestions** (28 follow-up, 10-12): a
  Document card on a map shows an image as its whole background fading into
  the card at the bottom, where the name is. The editor picks which of the
  Document's images (`relationship_map_cards.image_id`, migration
  `d5a1c8e3f2b7`, on this map only); until then the card follows the
  Document's favorite. An image deleted or no longer visible falls back to
  the favorite. The arrow label field no longer suggests earlier labels, and
  `GET /rooms/{id}/maps/labels` is gone (Decision 5 dropped by the product
  owner).

- **Room card menu and Duplicate Room** (spec 33, 10-12, no migration): the
  Room card's Setup and Invite buttons moved into its ⋮ menu (Setup, Invite,
  Duplicate, Leave, each only for who may use it). `POST
  /rooms/{id}/duplicate` (Master only) copies the Room's setup, Tags, Tag
  combinations and every Document with its Notes and images into a new Room
  "<name> (Copy)" in one transaction, the caller its only member and Owner;
  Comments, PDFs, Reveals, grants and relationship maps are not copied,
  Selective becomes Private, `@member` mentions become plain text. Images
  share the original's Storage objects, so no Storage call. Choices beyond
  the ticket, to confirm: maps are left out (cards point at Documents and
  would need re-pointing); the modal builds the copy's name from its own
  `rooms.duplicate.copyName` string, kept in step with the backend's
  `room.copySuffix`.
- **Relationship maps** (28_0, 28_1, 28_2, 10-12, PR #159): Document
  subtitle (`a8c4e2f6b1d3`); free boards per Room with Document and text
  cards, groups and labeled arrows that belong to their map only
  (`b3f7d1e9c5a2`, `/rooms/{id}/maps`); the board on `@xyflow/react`, saved
  automatically, read-only on phones. Choices beyond the ticket, to
  confirm: Maps button in the Room title actions plus a read-only link in
  View As; an arrow connects when dropped anywhere on the target card.
  Checked in Chromium through a local harness (drag, drop into a group,
  group drag, connecting), not against a running backend.
- **Hidden cards keep their place when their group is deleted** (28_1 fix,
  10-12, PR #160): a card in a group is stored relative to the group, so
  deleting the group left the cards the editor can't see at the board's
  origin; `plan_board_edit` now rewrites them with absolute positions.

- **No card preview while drawing an arrow** (10-15): once an arrow is
  started (`useConnection().inProgress`), the hover preview of map cards is
  disabled; it comes back when the arrow is completed or cancelled.

- **Map arrow dot grabbable again** (28_2 fix, 10-12, PR #170): the card
  image and text were laid over the arrow handle and the card's
  `overflow: hidden` cut it in half, so arrows could not be drawn; the
  handles now have `z-index: 1` and only the image layer is clipped.
- **Arrow labels stay clear of the cards** (28_2 fix, 10-12): a label
  slides along its arrow (`placeLabel`) until its box no longer touches the
  two cards it joins nor the other label; the box size is estimated from
  the text. When the arrow is too short for that, the label moves sideways
  (right or left, whichever clears the cards first) instead of staying
  centered over them, but never outside the area the two cards span: with
  no room there it stays at its usual spot (a sideways jump used to throw
  it past the far card on short arrows).

- **Label positions on relations, backend** (28_3, 10-13): `label_position` and
  `reverse_label_position` on `relationship_map_arrows` (migration
  `a9e3c5d7b1f4`, nullable floats 0 to 1, a position needs its label), saved
  with the board through the existing `PUT .../board`. Applied to the
  staging database by hand on 2026-10-13 (`alembic current` went from
  `d5a1c8e3f2b7` to `a9e3c5d7b1f4`) and to production on 2026-10-13. The drag and the "Relation" rename are
  the frontend step.
- **Label distance from the relation, backend** (28_3, 10-13): `label_offset` and
  `reverse_label_offset` on `relationship_map_arrows` (migration
  `b4d8f2a6c1e7`, nullable floats in board pixels, ±2000, an offset needs its
  label's position), so a dragged label can sit to the side of its relation.
  Applied to the staging database by hand on 2026-10-13 (`alembic current`
  went from `a9e3c5d7b1f4` to `b4d8f2a6c1e7`) and to production on 2026-10-13.
- **Dragging a relation's label, frontend** (28_3, 10-13): a label is dragged
  freely, along its relation and to either side (saved as `label_position` +
  `label_offset`, the distance kept within the backend's ±2000); the click
  that ends a drag no longer opens the relation; "Arrow" is "Relation" in all
  12 languages.

### 2026-10-08 → 10-10

- **Read aloud, first reading waits for voices** (30b, 10-10): Chrome's
  `getVoices()` is empty until loaded, so `useReadAloud` primes the list and
  `playSpeech` waits for `voiceschanged` (≤ 1.5 s).
- **GDPR** (31, 10-09): data export, account deletion (solo Rooms deleted,
  D-16 guard on shared ones, personal rows and the Auth account erased,
  shared content kept as an unknown user), `/privacy` notice in it/en.
- **Better voices** (30b, 10-09): "Automatica" picks the best installed
  voice (`voiceScore`/`rankVoices`); the Account page lists voices best
  first. A server voice (Piper or cloud TTS) is the next step if needed.
- **Read aloud** (30, 10-09): Web Speech API, no backend. Documents (name,
  description, visible Notes), single Notes and Comments; Pause/Resume/Stop;
  voice and speed per device in `localStorage`. Not done: whole-thread
  reading, sentence highlight.
- **Image search** (29, 10-08): "Cerca" picker over Openverse in the
  Document's "Immagini" row; `GET .../image-search`, Owners and the Master,
  30 searches a minute per user, optional `OPENVERSE_CLIENT_ID`/`_SECRET`.
- **Mentions follow renames** (bug, 10-08): edit boxes show tokens under the
  target's current name; "Mentioned in" excerpts are recut at read time.
  Search excerpts and the history diff still use stored names.
- **Image upload in the info panel** (10-08): "Immagini" row above "File",
  "Carica immagini" and "Da URL", visible without edit mode; buttons wrap on
  narrow windows.
- **Room PDF dialog fixes** (10-08): chosen style card highlighted; PDF
  attachments with only an owner password are now read.
- **Import keeps images after links expire** (10-08): images from this app's
  own bucket are read straight from Storage when the importer can see them.
  Cross-environment imports still need fresh links.
- **Document export and import** (27, 10-08): export one Document (JSON or
  Markdown); import Documents from JSON/Markdown (a Room export too) through
  a preview, Copy/Replace, and a background job. Migration `f7a2d8c4e1b9`.
  Decision to confirm: the import keeps the file's visibility levels since
  creation has no rule stopping a Player from setting Master-only.

### 2026-10-05 → 10-07

- **Room image** (26 + Room card follow-up, 10-07): `rooms.image_path`
  (migration `e9b4c2d7a1f6`), set by Administrators, default PDF cover,
  shown on the Room card.
- **Room setup Tags and rename** (25c, 10-07, PR #122): `PATCH
  /rooms/{id}/tags/{tag}`, `TagsSection`, shared `CompactList`.
- **Account page avatar block** (10-07): 200px avatar, centered actions.
- **Whole-Document history** (24b, 10-06): one revision history per
  Document (name, description, every Note); migration `c7d3e9a1f5b2`.
- **Version history** (24_1, 24_2, 10-05): drawer with word diff and
  Restore; edits by the same editor within 10 minutes merge. Migration
  `a2e6c9f4b8d1`. Not seen in a browser.
- **Room PDF** (23b_1a to 23b_2 and follow-ups, 10-05 → 10-06): Docker
  backend image; `app/domain/manual.py` + `app/pdf/` (WeasyPrint, Gothic,
  Modern, Print, A4/Letter); background jobs (`export_jobs`, migration
  `d9a4f1c7e3b5`, files kept 24 h); dialog with style cards; two balanced
  columns; one page per Document, two short ones may share a page; Notes as
  paragraphs, Comments (only those written as a Character) as boxed
  sidebars; glossary of Document names; no drop cap on a leading mention.
- **Room export** (23_1 to 23_3, 10-05): `GET /rooms/{id}/export`, JSON or
  Markdown, only what the requester sees, Markdown names escaped.
- **Full-text search** (21_1, 21_2, 10-05): accent/case-insensitive prefix
  search over Documents, Notes, Comments, Tags; `Ctrl+K` modal. Migration
  `c4e9a7f1d3b2`.

### 2026-10-01 → 10-04

- **View as a member** (22b, 10-03): `X-View-As` header for the Master,
  every write refused; banner with "Exit".
- **Reveal and visibility history** (22_1, 22_2, 10-03): Reveal on
  Documents, Notes, Comments; badge of unseen Reveals; History tab;
  `rooms.default_visibility`. Migration `b8d2f6a4c9e1`.
- **Open questions closed** (10-03): all 15 answered; `requirements.md`
  v0.5; no other user's email is ever sent; Facebook and X sign-in removed.
- **UI restyle** (10-03, PRs #81 to #85): Room page and top bar refactor
  (floating "+"), top bar pinned and hiding on scroll down, Document info
  panel, card restyle and more columns on wide screens, unread dot in the
  visibility badge, accessibility audit fixes.
- **Mention backlinks** (20_1, 20_2, 10-03): "Mentioned in"; mentions
  stored as tokens (migration `d7b3a9f2c5e8`).
- **Comments, feature 19** (10-02 → 10-03): threaded replies (19), unread
  replies (19b), reactions, pin and resolved, @mentions, promotion to a
  Note (19c_1 to 19c_8). Thread pagination (FR-T3) parked.
- **Friends and direct invitations** (18_1a, 18_1b, 18_2, 10-02).
- **Characters** (17, 10-01) and **PDF Attachments** (16, 10-01).
- **Leave Room** (15), tests moved to `src/test/` (14), Room and Tag
  deletion (13_1a to 13_1c), Notes on Documents (12_1, 12_2), Tag
  combinations (11_2), Index follows the Main items (11_3) (09-30 → 10-01).
- **Infrastructure**: Claude code review replaces CodeRabbit (PR #49),
  API errors follow the UI language, Claude Code on the web session setup,
  staging environment with its own Supabase project (10-04), `/health`
  answers HEAD (10-03).
- **Small fixes** (10-01): invite link survives sign-in, Room card
  navigation feedback, nullable Note mutation responses, Note reorder
  reload, Room deletion locks the Room before its Documents.

### 2026-09-21 → 09-30

Foundations, Documents and Comments, Account and security (private bucket,
RLS lockdown), Documents list and CI, localization (it/en), UX refinement
(spec 10), Room setup page (spec 11). See the 2026-09-30 archive.

## Next Up

Nothing is waiting for release: `staging` and `main` match after release
PR #246 (2026-10-27), and production's database is at head. Before the
next release, merge `main` into `staging` first, since Dependabot PRs land
on `main`.

- **46, Session 0 boards** (ticket confirmed by the product owner
  2026-10-27, building): a Room's Session 0 page with a Retro board and a
  Lines & Veils board (Must, Lines, Veils), draft/publish post-its
  (anonymous or signed), promotion as a copy by the Master (button +
  drag), reactions, a shared non-blocking timer, Session 0.5 rounds and
  live push updates (SSE, the app's first). One migration.
- **46b, Dichiarazione d'Intenti**: a suggested, editable Document template
  (the DDI's six sections). If a Room has one, its invitation opens the
  DDI read-only with an "accept and join" button at the end (product
  owner, 2026-10-27). Ticket not written yet.
- **Room landing page**: product owner's idea (2026-10-27), separate
  ticket, not written yet.
- **27b, PDF of one Document**: next to build (product owner,
  2026-10-08). Ticket written, decisions proposed, no migration expected.
- **Two small tickets, not written yet**: default Tags in the creator's UI
  language (decided 2026-10-03), and a read-only members list for every
  member (the setup page stays Administrator-only).
- **38, Geographic maps, open follow-ups**: image search for the
  background, dragging link labels, dragging area names by hand (needs a
  migration), a Tag picking an area's color.
- **43, Real-time maps, not built**: push, presence, editing from a phone
  (product owner, 2026-10-24).
- **45, Demo**: the sample Room has no images yet.
- **34, More UI languages, round two**: tr and zh-Hant, later.
- **Requirements not built** (`requirements.md` §14): Glossary entries
  (FR-N3/N4, VR-10), draft/published (FR-D6), notifications (FR-T9),
  sealed content (VR-09). The product owner decides whether they stay.
- **Parked**: Thread pagination (FR-T3), until Threads get long in practice.
- **Browser walk-through** (product owner): several features are built and
  unit-tested but never seen running: Notes (12), PDF Attachments (16),
  Characters (17), Friends (18), mention backlinks (20), search (21),
  version history drawer (24), Room export download and PDF dialog at phone
  width (23), early card and modal UI (07, 13). The full checklist is in the
  2026-10-10 archive under Next Up. A Playwright script is possible on
  request.
- **Owed by the product owner**: legal review of `/privacy` and the DPAs
  with Supabase, OVHcloud and Vercel (spec 31).
- **Ops, later**: delete the suspended Render production and old native
  staging services after quiet weeks; backups and monitoring for the VPS
  (`vps-migration-plan.md` §7/§8; NFR-07).
- **Decisions taken while building, still to confirm**: many units list
  "choices beyond the ticket" (specs 21 to 27); they are in the 2026-10-10
  archive under each unit.

## Open Questions

None. The 15 questions open at the time were closed with the product owner
on 2026-10-03 (`requirements.md` v0.5); v0.6 (2026-10-27) brought the spec
in line with what was built since.

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
