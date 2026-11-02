# 57 - UI consistency

## Goals

- Product owner's request (2026-11-02): "vorrei fare un analisi dello stile
  della UI/UX, analizzando cosa possiamo migliorare o eventuali discrepanze
  tra le diverse pages". The analysis (Claude Doc "Ex Libris — Analisi
  coerenza UI/UX", screenshots of the Demo in `ui-audit/` in the project
  files) found 16 discrepancies; the product owner answered "partiamo con lo
  sviluppo dei ticket proposti" the same day.
- Later the same day: "alcune volte la loading state [...] è centrata
  (correttamente), mentre in altri posti è nell'angolo in alto a sinistra".
  Added to 57c.
- Three units, built in this order on one branch: **57** phone fixes,
  **57b** one palette, **57c** shared page components.
- **Not** in scope: map pages' own toolbars, the landing page's editorial
  layout, the Session 0 boards' compact header (spec 46d), new features.
  No backend change, no migration.

## Today (before this ticket)

- The Room Index tab (`.room-index-tab`, fixed at 40% of the screen's
  height) covered the first letters of the page title on a phone ("lappe"
  for "Mappe").
- The Room setup's member table (`Table.ScrollContainer minWidth={560}`)
  hid its Administrator column and Remove buttons off the right edge of a
  phone; the heading's Export button was cut ("Esport").
- "Create Document" floated over the cards (`Affix`) on every screen size,
  while every other page has its main action in the heading.
- `theme.ts` did not define Mantine's `dark` scale, so every component
  without a class of its own was neutral grey: Room cards
  (`--mantine-color-dark-6`, #2e2e2e), the maps row's cards, inputs,
  selects, "Mentioned in", Papers without `bg` (#242424), borders (#424242).
- Destructive buttons used Mantine's `red` (#fa5252), almost the same hue as
  the accent (#ea3333), so "Delete" and "Create" looked alike.
- Page headings came in three hand-made variants (kicker + rule, rule only,
  nothing) and the kicker meant different things (Documents: "DOCUMENTS"
  over the Room name; Maps: the Room name over "Maps").
- In-page loaders (`<Loader />` in the page flow) sat in the top-left corner
  under the heading, while the full-page one (`FullPageLoader`) is centered.
- Empty lists: Maps had a dashed card with an icon, Rooms and Documents only
  a dimmed line.
- Section headings inside Session 0 modules were `fz="h4"` while the setup,
  Comments and Account sections are `fz="h3"`; Session 0's Cancel buttons
  were `variant="default"`, everywhere else `subtle` grey.

## Decisions

Proposed by Claude on 2026-11-02 in the analysis; the product owner asked
to build them the same day. The three open questions of the analysis were
taken with the defaults below, to confirm in the PR.

### 57 - Phone fixes

1. **The Index tab never covers content**: a page that shows it keeps a
   left padding as wide as the tab (40px on a phone, 48px from `sm`).
2. **Room setup members on a phone (< 36em)** become one block per member:
   who they are, then a labelled Role select, a labelled Administrator
   switch and Leave/Remove on one wrapping row. The table stays from 36em.
3. **Heading actions wrap** under the title on a narrow screen instead of
   being cut (via `PageHeading`, 57c).
4. **"Create Document"** (open question 1, default): in the heading on a
   wide screen, like every other page's main action; floating at the
   bottom right only on a phone (< 48em), where it stays within reach.

### 57b - One palette

5. **Mantine's `dark` scale is rebuilt from the tokens**: 0 `--text-primary`,
   2 `--text-muted` (dimmed), 4 #3a3042 (borders, input edges), 5 #2c2433
   (hover), 6 `--bg-raised` (inputs, default buttons), 7 `--bg-surface`
   (papers), 9 `--bg-base`. Every Card sits on `--bg-surface` (one CSS
   rule), like a Document card; the Room card loses its own grey fade.
6. **A `danger` colour** anchored on `--state-error` (#dc2626) replaces
   `color="red"` on every button, action icon, menu item and badge. Error
   *text* (`c="red"`) is unchanged.
7. Redundant `bg="var(--bg-surface)"` on Papers is removed.

### 57c - Shared page components

8. **`PageHeading`** on every page with a heading (My Rooms, Room home,
   Documents, Maps, Section, setup, Session 0 before it starts, Account):
   optional kicker, the `h1` at the h2 size, optional description, actions
   on the right, a fine rule under it. Privacy's h1 is h2-sized too.
9. **Kicker rule**: on a Room's pages the kicker is the Room's name and the
   title is the page (Documents, Maps, setup, Section); the Room's home is
   titled with the Room's name and its kicker says "Home". The Documents
   page's `h1` is therefore "Documents", no longer the Room's name.
10. **`SectionLoader`**: in-page loading is a spinner centered in the page's
    width with 48px above and below, on My Rooms, Room home, Documents,
    Maps, Section, setup, its visibility history and Session 0.
11. **`EmptyState`**: the Maps page's dashed card with an icon, now also on
    My Rooms (door icon) and Documents (books icon).
12. Section headings inside Session 0 modules are `fz="h3"`, like every
    other page's sections; every Cancel button is `subtle` grey.
13. **The Index tab** (open question 3, default) also shows on the setup
    page and on Session 0 (where its Session 0 entry is current).
14. **Room setup sections** (open question 2, default): unchanged for now
    (Members and image in cards, Tags and the danger zone as titled
    sections); to revisit if the product owner prefers one style.

## Design

- `frontend/src/theme/theme.ts`: `dark` and `danger` tuples.
- `frontend/src/index.css`: `.page-heading*`, the dark-scheme Card rule,
  `.empty-state`, `.member-list-item`; the old `.documents-page-heading`,
  `.maps-page-heading`, `.rooms-heading` and kicker/title classes removed.
- `components/PageHeading.tsx`, `components/EmptyState.tsx`,
  `SectionLoader` in `components/PageState.tsx`.
- `components/PageLayout.tsx`: left padding when the Index shows.
- `components/setup/MemberManagement.tsx`: phone blocks
  (`useMediaQuery('(max-width: 36em)')`).
- `pages/RoomDocumentsPage.tsx`: `useMediaQuery('(max-width: 48em)')`
  chooses the heading button or the floating one.

## Tests

- MemberManagement on a phone: no table, labelled switches and selects,
  the Administrator switch still saves.
- Documents: "Create Document" is in the heading on a wide screen and not
  on a phone; the page's `h1` is "Documenti" with the Room as kicker.
- RoomCard: no own fade colour.
- Visual check: before/after screenshots of the Demo (desktop 1440px,
  phone 390px) in `ui-audit/` and `ui-audit/after/` in the project files.
