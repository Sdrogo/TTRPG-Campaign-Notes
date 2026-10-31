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
  **sources** (Documents with some Tags, maps, Session 0 features),
  whose items show as the same kind of card.
- Nothing that exists goes away: the Documents page, the Maps page and
  Session 0 stay where they are and are reachable from the landing.
- `requirements.md` is protected and is not changed by this ticket. The
  landing is new navigation over existing content, so it adds no `FR-`;
  if the product owner wants one, it is added on request.

## Decisions

Proposed by Claude on 2026-10-31 from the request; the product owner
answered Q1-Q5 the same day (see "Answers" below) and asked for
subdivisions inside Documents blocks. The Decisions follow those answers
and the feedback on the clickable mockup (55_m, done the same day); the
product owner confirmed the ticket and the mockup on 2026-10-31 ("ok, mi
sembra buono").

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
    (the same AND filter as the Documents page), by name, optionally split
    into **groups** (Decision 15).
  - `maps`: the Room's maps, optionally only one kind (geographic,
    relationship, mention maps), by name.
  - `session_zero`: what the Master picks of Session 0 (product owner,
    2026-10-31: adding it must let the Master choose which Session 0
    features to show), one or more **features**: Sessioni (the sessions,
    spec 47b, newest first), Retro, Linee e Veli, Stelle e Desideri,
    Domande, DDI, Sondaggi (spec 53). Each feature lists its items (one
    card per step of that kind, newest session first; Linee e Veli is one
    card, being one per Room; Sondaggi one card per poll). With more than
    one feature the block shows them under foldable headings, **in the
    order the Master gives them** (product owner, 2026-10-31), like
    Documents groups.
  A block has an optional heading of its own; without one it is titled
  after its source ("Documenti · Tokyo, PNG", "Mappe geografiche",
  "Sondaggi" for a single feature, "Sessione 0" for several).
- **Page card**: a Section card that, instead of a page of blocks, opens
  one of the Room's existing pages: Documents, Maps or Session 0.

### Who does what

1. **Only the Master** creates, edits, orders and deletes Sections
   and blocks (content power, D-08, D-28): 403 for anyone else. An
   Administrator who is not a Master sees the landing like a Player. With
   more than one Master, any of them can edit.
2. **Every Section is visible to every member** of the Room (Q5:
   Master-only Sections are out of scope). What a viewer sees inside it
   still depends on the items' own visibility (Decision 3).
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
   them too (Q3: they show what the app offers today). The Master can
   retitle them, give them an image and a description and move them. The
   Documents card can't be deleted (409: it's the way to the full list,
   and the Index's Tag links lead there too); the other two can be
   deleted and added back from "Nuova sezione".
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
   - Session 0 step (Retro, Stelle e Desideri, Domande): no image, "Retro ·
     Sessione 1", a one-line summary (post-its, answers given). Linee e
     Veli: the counts. DDI: its Document's image if any, "Accettata da 4 su
     5".
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

10. **The Index: the Room's Sections first, then the page on screen** (Q4;
    product owner, 2026-10-31: the Tag lists can grow very long and would
    fill the card, so keep only the Room's sections). On top, on every
    Room page: "Home della Stanza" (the landing), then **Sezioni**, every
    Section card of the landing in its order (the page cards Documenti,
    Mappe, Sessione 0 included), the current one marked. The Tag groups
    (Main Tags, other Tags) and the list of maps of spec 44 leave the
    Index: Tags stay one click away on the Documents page, maps on the
    Maps page. After it, inside a custom Section only, a group titled
    after the Section, set apart by a divider, lists what is on screen:
    every block heading (scrolling to it) and, under it, its groups or
    features. On the landing and on every other page this group is
    absent (on the landing it would repeat the Sezioni list).

### Editing

The product owner (Q1) asks for a UI that is easy to understand,
**compact (not one row per element)** and intuitive. The principle: the
Master edits **on the page itself, as it will look** (what you see is
what the Players get), with small chips and popovers, never a long form.

11. **Edit mode.** The Master sees a "Modifica" button (pencil) beside the
    page's title, on the landing and on a Section. Edit mode changes no
    layout: the same cards and blocks stay where they are and only gain
    handles. Every change is saved as it is made (no global Save) and
    shows at once; "Fine" leaves edit mode. A thin accent outline around
    the page content says edit mode is on.
12. **On the landing**, in edit mode each Section card gets a drag handle
    in its corner and a ⋮ (Modifica info, Elimina with confirmation); the
    cards reorder by drag (`@dnd-kit`, as Session 0, keyboard included). A
    dashed "Nuova sezione" card closes the grid: it asks only the title
    (one field, Enter to confirm), creates the Section and opens it in
    edit mode with the "add block" picker already open, so the Master goes
    from nothing to a filled Section in three clicks.
    "Modifica info" is a small dialog with only the card's own fields:
    title, description (mention textarea), image (upload, from URL, image
    search, remove: the Room image pipeline, spec 26/29).
13. **In a Section**, in edit mode each block's heading becomes a **block
    bar**, one line that wraps on a phone:
    `⠿  [icon] Heading ✎  ·  [#Tokyo ×] [#PNG ×] [+ Tag]  ·  [Raggruppa ▾]  ⋮`
    - the drag handle reorders blocks;
    - the heading is edited in place (click, type, Enter); empty means
      "named after its source";
    - the **filter is chips**: a Documents block shows one chip per Tag
      (× removes it, "+ Tag" opens a searchable Tag picker as a popover);
      a maps block a single chip with its kind ("Tutte le mappe" ▾ →
      Tutte / Geografiche / Relazioni / Mention map); a Session 0 block one
      chip per feature, dragged to reorder (the order of the headings
      below), × removes it, "+ Funzione" opens the features list (ticks on
      the ones shown; a newly ticked feature goes last);
    - "Raggruppa" (Documents blocks only) opens the groups popover
      (Decision 15);
    - ⋮ holds Elimina (with confirmation, undoable by a toast "Annulla"
      for 5 s).
    The block's cards under the bar are the real result and refresh as
    soon as a chip changes.
    The **sub-sections** of a block (a Documents block's groups, a Session 0
    block's features) can also be dragged whole by their heading, which
    shows a ⠿ handle in edit mode (product owner, 2026-10-31); it is the
    same order as the chips, so either way changes both. "Altri documenti"
    stays last and can't be moved.
14. **Adding a block**: a dashed "+ Blocco" bar after the last block (and,
    on hover or focus, a small "+" between two blocks) opens a popover
    with **three tiles in a row** (one column on a phone; icon, name, one
    line: "Documenti", "Mappe", "Sessione 0"). Picking one inserts the
    block there; a Documents block opens its Tag picker straight away (it
    needs at least one Tag), a Session 0 block its features list (it needs
    at least one feature). On a
    phone, the popovers open as bottom sheets.
    Limits: a Section holds 1 to 10 blocks, a Room up to 30 Sections.
15. **Groups inside a Documents block** (product owner, 2026-10-31: "voglio
    che sia ancora possibile creare sottodivisioni (come facciamo ora per
    la RoomDocumentPage) nei block di Documents"): a Documents block can
    split its Documents into groups exactly like the Documents page does
    with the Main items (spec 11, 11_2): an ordered list of groups, each a
    single Tag or a combination of Tags; a Document is shown under every
    group whose Tags it all carries, the others under "Altri documenti"
    (or no heading when the block has no group). Each group heading folds
    with a caret like a Documents page group (starts open, not
    remembered). The groups popover is compact too: the groups as chips in
    one wrapping line, dragged to reorder, × to remove, "+ Gruppo" picks
    one or more Tags (several = a combination), and "Usa i raggruppamenti
    della Stanza" copies the Room's Main items in one click. A block holds
    up to 20 groups. The grouping and ordering code is the Documents
    page's (`groupDocuments` or its equivalent), not a copy.
16. **Mockup first**: before 55_3 is built, Claude makes a clickable HTML
    mockup of edit mode (landing, block bar, add-block tiles, groups
    popover, phone bottom sheets) for the product owner to try, and the
    ticket is adjusted to the feedback.
17. **Tags going away**: deleting a Tag removes it from every block and
    group; a Documents block left with no Tag is deleted, and a group
    left with no Tag is dropped (one whose Tags now equal another group's
    merges into it), in the same transaction, as Tag combinations are
    rewritten today (spec 13_1). Renaming a Tag needs nothing (blocks hold
    ids).
18. **Live updates**: a Section change is pushed on the Room stream of
    spec 52 (`kind: "landing"`), so a Player's open landing refreshes
    without reload. Items already refresh through their own events.

### Not in scope

- Hand-picking single Documents or maps into a block (Q2: a block is a
  rule the Master sets with Tags, and a new Document with those Tags
  shows up by itself).
- Master-only Sections (Q5).
- Sections inside Sections, a Section as a Room's default page other than
  the landing, per-Player Sections.
- Sections in the Room JSON export/import and in the PDF manual
  (duplication copies them, Decision 5).
- Groups inside maps blocks, or Session 0 blocks beyond one heading per feature.

## Design

### Backend (migration)

- **Migration** (revises the head at build time): 
  - `room_sections`: `id`, `room_id` (FK `rooms`, cascade), `position`
    (int), `kind` (`custom` | `page_documents` | `page_maps` |
    `page_session_zero`), `title` (varchar 100, null), `description` (text,
    default ''), `image_path` (varchar 300, null), `created_at`,
    `updated_at`. Unique
    (`room_id`, `kind`) for the three page kinds (partial index). RLS on,
    deny-all policy, like every backend-only table.
  - `room_section_blocks`: `id`, `section_id` (FK cascade), `position`,
    `kind` (`documents` | `maps` | `session_zero`), `heading`
    (varchar 100, null), `map_kind` (null = all, or a map kind),
    `features` (ordered text[], the Master's order, of `sessions`, `retro`, `lines_veils`, `stars`,
    `questions`, `ddi`, `polls`; not empty on `session_zero` blocks).
    Checks: `map_kind` only on `maps` blocks, `features` only on
    `session_zero` blocks.
  - `room_section_block_tags`: (`block_id`, `tag_id`), both FK cascade.
  - `room_section_block_groups`: `id`, `block_id` (FK cascade),
    `position`; `room_section_block_group_tags`: (`group_id`, `tag_id`),
    both FK cascade (the shape of `tag_combinations`).
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
    `X-View-As` honoured), a Documents block's groups included.
  - `POST /rooms/{id}/sections`, `PATCH .../{sid}`, `DELETE .../{sid}`,
    `PUT /rooms/{id}/sections/order` (`[ids]`), block CRUD and
    `PUT .../{sid}/blocks/order`; image upload/URL/remove like
    `room_image.py`, under `rooms/{room_id}/sections/{random}.webp`. All
    writes Master-only (403), lock the Room's sections with
    `SELECT ... FOR UPDATE` on the Room row, publish `landing` on commit.
    Block groups: `PUT .../blocks/{bid}/groups` replaces the whole ordered
    list in one call (`[[tag ids]]`), which is what the popover sends.
  - Room creation, duplication (`room_copy`) and import seed or copy the
    Sections (duplication copies images too, like Document images).
  - Tag deletion (`tags_repo`) drops emptied Documents blocks.
- Session 0 features reuse `session_zero_repo` /
  `session_zero_polls_repo` reads; no change to Session 0 tables.

### Frontend

- `pages/RoomLandingPage.tsx` (`/rooms/:roomId`), `pages/RoomSectionPage.tsx`
  (`/rooms/:roomId/sections/:sectionId`), `components/landing/`
  (`LandingCard`, `SectionGrid`, `SectionBlock`, `SectionInfoModal`,
  `BlockBar`, `AddBlockPicker`, `BlockGroupsPopover`, `TagChipPicker`), hooks `useRoomSections`,
  `useRoomSection`, mutations in `lib/api`.
- `index.css`: `.landing-card` sharing the `.document-card` rules
  (border, shadow, hover lift, reduced motion) instead of copying them.
- `RoomCard` links to `/rooms/:id`; `backNav` treats the landing as the
  Room's root.
- `RoomIndex` drops the Tag groups and the maps list (`useTags`,
  `useMainItems`, `useMaps` no longer read there), lists the landing link
  and the Sections (`useRoomSections`), and takes an optional
  `pageEntries` prop (through `PageLayout`) rendered after a divider;
  `RoomIndex.test.tsx` is rewritten accordingly.
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
| 55_1 | Backend: tables, seed, Sections/blocks/groups API with resolved items, image, Tag deletion, duplication/import seed, live event, tests | yes | about 2 h |
| 55_2 | Frontend read side: landing and Section pages, `LandingCard`, block groups, Room card link, Back, Index group, Session 0 deep links, i18n, tests, screenshots | no | about 1.5 h |
| 55_m | Clickable HTML mockup of edit mode, for feedback (Decision 16) | no | about 45 min |
| 55_3 | Frontend edit side: edit mode, drag order, block bar with chips, add-block tiles, groups popover, info dialog, bottom sheets on phone, tests, screenshots | no | about 2.5 h |

About 7 hours in all, in three PRs into `staging` (or one branch with three
commits, as the product owner prefers). The migration goes to the staging
DB before 55_1 is merged and to production before the release that ships
it.

## Tests

- Backend: Master-only writes (403 Player, Administrator-not-Master); a Documents
  block shows only Documents with all its Tags that the viewer sees; maps
  block filtered by kind and visibility; a Session 0 block lists only its
  features' items, a draft or a step the Players haven't reached is never
  shown to them (spec 46/47 rules), an empty features list is 422; limits (30
  Sections, 10 blocks, 422); reorder; the Documents page Section can't be
  deleted (409); Tag deletion drops an emptied block and keeps one with
  Tags left, drops an emptied group and merges duplicates; a block's
  groups are replaced in order and a Document shows under every group
  it matches, the rest under "others"; seed on create, copy on duplicate; migration seeds existing
  Rooms.
- Frontend: Room card opens the landing; landing lists Sections in order;
  a Section renders blocks, groups (folding) and item cards with their
  links; empty blocks hidden for Players; the Index lists Home and the Sections
  (no Tags, no maps) and, in a custom Section only, the page group after
  them; edit mode only for the Master; "Nuova sezione" asks a title
  and opens the add-block tiles; a Session 0 block opens its features
  list and shows one heading per feature; a Tag chip added or removed refetches the
  block; "Usa i raggruppamenti della Stanza" copies the Main items; drag
  reorder calls the order endpoint; Session 0 opens
  the session from `?session=`.
- Screenshots at desktop and phone width: landing, a Section with groups,
  edit mode with the block bar, the add-block tiles, the groups popover,
  the Index on a Section.

## Answers (product owner, 2026-10-31)

- Q1 (what a Section holds): several blocks, yes, but the UI must be
  studied well: easy to understand, compact (not one row per element),
  intuitive. -> Decisions 11-16.
- Q2 (rules or hand-picked): rules; the Master picks the Tags and a new
  Document with them is added by itself.
- Q3 (three Page cards): yes, they represent what the app offers today.
- Q4 (Index): global navigation on top, the current view's detail after.
  -> Decision 10.
- Q5 (Master-only Sections): not in scope. -> Decision 2.
- Also asked: subdivisions inside Documents blocks, as on the Documents
  page. -> Decision 15.
- After the mockup: adding a Session 0 block must let the Master choose
  which Session 0 features it shows. -> the `session_zero` block kind
  (Terms), Decisions 13-14.
