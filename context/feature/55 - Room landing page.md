# 55 - Room landing page

## Goals

- Product owner's request (2026-10-31): "vorrei iniziare a pensare un pò a
  questa idea della landing page per le Room. l'idea è quello di poter
  personalizzare diverse "Dashboard" (e.g. Mappe geografiche, lista dei
  Documenti con certi TAG specifici, Sessioni 0, Sondaggi). Il master crea
  una sottosezione selezionando cosa vuole mostrare. L'indice riflette la
  Landing page o la sottosezione visualizzata al momento. A livello visivo,
  i singoli elementi della Landing devono essere simili alle schede dei
  documenti, con un immagine (opzionale), un titolo, una descrizione
  (opzionale), la UX è simile, ma senza preview, all hover del mouse la card
  si eleva come succede ora nella RoomDocumentPage."
  (I'd like to start thinking about a landing page for Rooms: several
  customizable "Dashboards", e.g. geographic maps, a list of the Documents
  with some specific Tags, Session 0s, polls. The Master creates a
  subsection by choosing what it shows. The Index reflects the landing page
  or the subsection on screen. Each element of the landing looks like a
  Document card, with an optional image, a title and an optional
  description; same UX but without preview; on mouse hover the card lifts
  as it does today on the Documents page.)
- A Room gets a **home page** of its own, `/rooms/:roomId`, made of cards
  the Master arranges. Each card opens a **Section** (the "Dashboard" /
  "sottosezione" of the request): a page the Master composes from a few
  **sources** (Documents with some Tags, maps, Session 0 sessions, polls),
  whose items show as the same kind of card.
- Nothing that exists goes away: the Documents page, the Maps page and
  Session 0 stay where they are and are reachable from the landing.
- `requirements.md` is protected and is not changed by this ticket. The
  landing is new navigation over existing content, so it adds no `FR-`;
  if the product owner wants one, it is added on request.

## Decisions

Proposed by Claude on 2026-10-31 from the request, to confirm in the PR.
The open questions are under "Questions"; the Decisions below follow the
recommended answer of each.

### Terms

- **Landing**: the Room's home page, `/rooms/:roomId`. A grid of
  **Section cards**.
- **Section**: one card on the landing and the page it opens,
  `/rooms/:roomId/sections/:sectionId`. It has a title (up to 100
  characters), an optional description (up to 2000, Markdown and mentions
  like a Note, spec 48), an optional image, and an ordered list of
  **blocks**.
- **Block**: one source inside a Section, shown as a small heading and a
  grid of **item cards**. Kinds:
  - `documents`: the Documents carrying **all** of one or more chosen Tags
    (the same AND filter as the Documents page), by name.
  - `maps`: the Room's maps, optionally only one kind (geographic,
    relationship, mention maps), by name.
  - `sessions`: the Session 0 sessions (spec 47b), newest first.
  - `polls`: the Session 0 polls (spec 53), newest session first, then in
    step order.
  A block has an optional heading of its own; without one it is titled
  after its source ("Documenti · Tokyo, PNG", "Mappe geografiche",
  "Sessioni", "Sondaggi").
- **Page card**: a Section card that, instead of a page of blocks, opens
  one of the Room's existing pages: Documents, Maps or Session 0.

### Who does what

1. **Only the Master** creates, edits, orders, hides and deletes Sections
   and blocks (content power, D-08, D-28): 403 for anyone else. An
   Administrator who is not a Master sees the landing like a Player. With
   more than one Master, any of them can edit.
2. **Visibility of a Section**: "Everyone" (default) or "Master only". A
   Master-only Section is not listed, not reachable (404) and not in the
   Index for a Player; the Master sees it with a "Solo Master" badge, and
   "View as" (spec 22b) hides it like for the Player.
3. **Items follow their own visibility**: a block never shows a Document,
   map, session or poll the viewer could not open from its own page (the
   same backend filters, `X-View-As` honoured). A Player's Section can so
   look shorter than the Master's; a block with nothing visible shows "Niente
   da mostrare" for the Master and is left out for everyone else, and a
   Section whose blocks are all empty shows a short empty state.

### The landing

4. **The Room card opens the landing** (`/rooms/:roomId`) instead of the
   Documents page. The header's Back from Documents, Maps and Session 0
   leads to the landing; from the landing it leads to My Rooms.
5. **Every Room starts with three Page cards**: "Documenti", "Mappe",
   "Sessione 0", in this order, so an existing Room's landing is never
   empty and nothing becomes harder to reach. The migration adds them to
   every existing Room, and creating, duplicating or importing a Room adds
   them too. The Master can retitle them, give them an image and a
   description and move them. The Documents card can't be deleted nor set
   to Master only (409 for both: it's the Players' way to the full list,
   and the Index's Tag links lead there too); the other two can be hidden
   from Players or deleted, and added back from "New section".
6. **Layout**: the Room's name and image as the page's heading (as the
   Documents page has it today), the Section cards under it in a grid: 1
   column on a phone, 2 from `sm`, 3 from `lg`, 4 from `xl` (the Documents
   page's breakpoints). The Room's description, if the Room gets one later,
   is not in scope.

### Cards

7. **One card component for everything** (`LandingCard`): an optional image
   filling the right half like a Document card (`DocumentCardImages`
   layout, one image only), the title in the display font, the description
   as plain text clamped to 3 lines (`markdownToPlain`), the 2 px top border
   that turns accent and the `translateY(-3px)` lift with the deeper shadow
   on hover, exactly as `.document-card:hover` today (reduced motion: no
   lift, only the border). The whole card is one link. **No preview**: no
   mention hover preview (spec 32), no open menu or split view (spec 37),
   mentions in the description are plain text.
8. **What an item card shows**:
   - Document: its first image, its name, its description.
   - Map: a geographic map's background image, its name, its description
     (or its kind when it has none).
   - Session: no image, its name ("Sessione 3"), its date and steps
     ("31 ott · Retro, Sondaggi") as description; a "In corso" badge on the
     open one.
   - Poll: no image, its question, its state as description ("Aperto · 3
     su 5 hanno votato", "Chiuso · vince Stanza 404" once its results are
     visible to the viewer, spec 53/54 rules).
9. **Where an item card leads**: a Document to its page, a map to its
   page, a session or a poll to the Session 0 page **on that session**
   (and that poll's step): Session 0 gets `?session=<id>&step=<id>` deep
   links, read once on open (today it always opens the current session).

### The Index (spec 44)

10. **The Index reflects the page on screen.** A new first group, titled
    after the page ("Home" on the landing, the Section's title inside a
    Section), lists what is on screen: on the landing every Section card
    the viewer sees; in a Section every block heading (scrolling to it)
    and, under it, its items (opening them). The current groups (Main
    Tags, other Tags, Session 0, Maps) stay below it, so the Index keeps
    working as today on every other page, where the new group is absent.
    The landing itself is the first link of the Index ("Home della Stanza")
    on every Room page.

### Editing

11. **Edit mode.** The Master sees a "Modifica" button on the landing and
    on a Section. In edit mode the cards can be dragged to reorder (the
    same `@dnd-kit` setup as Session 0, keyboard included), each card has a
    ⋮ menu (Edit, Visibility, Delete with confirmation), and a "Nuova
    sezione" card closes the grid. Leaving edit mode is "Fine"; every
    change is saved as it is made (no global Save).
12. **The Section dialog** (new and edit): title, description (mention
    textarea), image (upload, from URL, image search, remove: the Room
    image pipeline, spec 26/29), visibility, and the blocks: "Aggiungi
    blocco" picks the kind, then its filter (Tags multi-select for
    Documents, kind for maps), an optional heading; blocks reorder by drag
    and delete with ×. A Section holds 1 to 10 blocks, a Room up to 30
    Sections.
13. **Tags going away**: deleting a Tag removes it from every block; a
    Documents block left with no Tag is deleted in the same transaction,
    as Tag combinations are rewritten today (spec 13_1). Renaming a Tag
    needs nothing (blocks hold ids).
14. **Live updates**: a Section change is pushed on the Room stream of
    spec 52 (`kind: "landing"`), so a Player's open landing refreshes
    without reload. Items already refresh through their own events.

### Not in scope

- Hand-picking single Documents or maps into a block (a block is a rule
  that stays up to date by itself; see Q2).
- Sections inside Sections, a Section as a Room's default page other than
  the landing, per-Player Sections.
- Sections in the Room JSON export/import and in the PDF manual
  (duplication copies them, Decision 5).

## Design

### Backend (migration)

- **Migration** (revises the head at build time): 
  - `room_sections`: `id`, `room_id` (FK `rooms`, cascade), `position`
    (int), `kind` (`custom` | `page_documents` | `page_maps` |
    `page_session_zero`), `title` (varchar 100, null), `description` (text,
    default ''), `image_path` (varchar 300, null), `visibility`
    (`everyone` | `master`), `created_at`, `updated_at`. Unique
    (`room_id`, `kind`) for the three page kinds (partial index). RLS on,
    deny-all policy, like every backend-only table.
  - `room_section_blocks`: `id`, `section_id` (FK cascade), `position`,
    `kind` (`documents` | `maps` | `sessions` | `polls`), `heading`
    (varchar 100, null), `map_kind` (null = all, or a map kind). Check:
    `map_kind` only on `maps` blocks.
  - `room_section_block_tags`: (`block_id`, `tag_id`), both FK cascade.
  - Data step: three page Sections for every existing Room, with `title`
    null so the client shows the default name in the viewer's language
    (see "Strings" below); `title` is nullable for the page kinds only
    (check constraint).
- **Domain** `app/domain/room_sections.py` (pure): limits, ordering
  (move = rewrite positions 0..n), the page kinds' rules (Documents not
  deletable), which blocks a Tag deletion drops.
- **Routes** `app/api/room_sections.py`:
  - `GET /rooms/{id}/sections`: the landing for the caller (visible
    Sections, in order, image as signed link).
  - `GET /rooms/{id}/sections/{sid}`: one Section with its blocks and
    their **resolved items** for the caller (one query per block through
    the existing visibility filters of Documents, maps, Session 0;
    `X-View-As` honoured). 404 for a hidden one.
  - `POST /rooms/{id}/sections`, `PATCH .../{sid}`, `DELETE .../{sid}`,
    `PUT /rooms/{id}/sections/order` (`[ids]`), block CRUD and
    `PUT .../{sid}/blocks/order`; image upload/URL/remove like
    `room_image.py`, under `rooms/{room_id}/sections/{random}.webp`. All
    writes Master-only (403), lock the Room's sections with
    `SELECT ... FOR UPDATE` on the Room row, publish `landing` on commit.
  - Room creation, duplication (`room_copy`) and import seed or copy the
    Sections (duplication copies images too, like Document images).
  - Tag deletion (`tags_repo`) drops emptied Documents blocks.
- Sessions and polls lists reuse `session_zero_repo` /
  `session_zero_polls_repo` reads; no change to Session 0 tables.

### Frontend

- `pages/RoomLandingPage.tsx` (`/rooms/:roomId`), `pages/RoomSectionPage.tsx`
  (`/rooms/:roomId/sections/:sectionId`), `components/landing/`
  (`LandingCard`, `SectionGrid`, `SectionBlock`, `SectionEditModal`,
  `BlockEditor`, `LandingEditBar`), hooks `useRoomSections`,
  `useRoomSection`, mutations in `lib/api`.
- `index.css`: `.landing-card` sharing the `.document-card` rules
  (border, shadow, hover lift, reduced motion) instead of copying them.
- `RoomCard` links to `/rooms/:id`; `backNav` treats the landing as the
  Room's root.
- `RoomIndex` takes an optional `pageEntries` prop (through
  `PageLayout`), rendered as the first group; the landing link on top.
- `SessionZeroPage` reads `?session=&step=` once.
- **Strings**: the three page Sections store `title` null while untouched,
  and the client shows `t('landing.page.documents')` etc., so they read in
  the viewer's language; the Master's own title replaces it. All new
  strings in the 12 languages (`i18n-glossary.md`: "Sezione", "Home",
  "blocco").
- Docs: `architecture.md` (tables, routes, landing as Room root),
  `ui-context.md` (landing, cards, edit mode, Index), `progress-tracker.md`.

## Units

| Unit | What | Migration | Claude's build time |
|---|---|---|---|
| 55_1 | Backend: tables, seed, Sections/blocks API with resolved items, image, Tag deletion, duplication/import seed, live event, tests | yes | about 2 h |
| 55_2 | Frontend read side: landing and Section pages, `LandingCard`, Room card link, Back, Index group, Session 0 deep links, i18n, tests, screenshots | no | about 1.5 h |
| 55_3 | Frontend edit side: edit mode, drag order, ⋮ menu, Section dialog with blocks and image, tests, screenshots | no | about 1.5 h |

About 5 hours in all, in three PRs into `staging` (or one branch with three
commits, as the product owner prefers). The migration goes to the staging
DB before 55_1 is merged and to production before the release that ships
it.

## Tests

- Backend: Master-only writes (403 Player, Administrator-not-Master);
  Master-only Section 404 for a Player and under "View as"; a Documents
  block shows only Documents with all its Tags that the viewer sees; maps
  block filtered by kind and visibility; sessions/polls blocks; limits (30
  Sections, 10 blocks, 422); reorder; the Documents page Section can't be
  deleted nor set to Master only (409 for both); Tag deletion drops an emptied block and keeps one with
  Tags left; seed on create, copy on duplicate; migration seeds existing
  Rooms.
- Frontend: Room card opens the landing; landing lists Sections in order
  and hides Master-only ones for a Player; a Section renders blocks and
  item cards with their links; empty blocks hidden for Players; Index
  shows the page group on the landing and in a Section, not elsewhere;
  edit mode only for the Master; the dialog creates a Section with a
  Documents block; drag reorder calls the order endpoint; Session 0 opens
  the session from `?session=`.
- Screenshots at desktop and phone width: landing, a Section, edit mode,
  the dialog, the Index on a Section.

## Questions

Q1. **What does a Section hold?** Recommended: several blocks (e.g.
    "Tokyo" = geographic maps + Documents tagged Tokyo + its polls), so a
    Section is a real dashboard. Alternative: one source per Section (a
    Section is just "Documents with Tag X" or "Geographic maps"), simpler
    to build and edit.
Q2. **Rules or hand-picked items?** Recommended: rules (Tags, map kind,
    all sessions/polls), so a new Document with the Tag appears by itself.
    Hand-picking single items would be a later addition.
Q3. **The three Page cards** (Documents, Maps, Session 0) on every
    landing: OK, or should the landing hold only the Master's Sections?
Q4. **The Index**: a new first group for the page on screen, keeping Tags,
    Session 0 and Maps below (recommended), or should the Index show only
    the landing/Section content while on those pages?
Q5. **Master-only Sections** (to prepare a Section before showing it): in
    scope, or every Section visible to everyone?
