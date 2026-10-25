# 44 - Room Index tab

## Goals

- Product owner's request (2026-10-25): "Vorrei ridefinire l'Indice/Glossario
  di una Room. Al momento l'apriamo dal Burger Menu. Vogliamo che si apra
  attraverso la pressione di un tasto sul bordo sinistro della Room.
  Cliccando su questo pulsante apre una piccola card con i collegamenti alle
  varie Sezioni della Room, in maniera similare a quello che c'è ora. Voglio
  anche aggiungere la sezione delle mappe a questo Indice/Glossario."
  (I'd like to redefine a Room's Index/Glossary. Today it opens from the
  burger menu. It should open by pressing a button on the Room's left edge;
  the button opens a small card with links to the Room's sections, much like
  today. I also want to add the maps section to the Index.)
- The Room's Index (today `GlossaryIndexDrawer`, spec 10, Main items from
  spec 11_3) moves from a full-height drawer behind the header's burger to a
  **tab fixed on the left edge of every Room page** that opens a **small
  card** beside it.
- The Index gains a **Maps** section, so the Room's maps (spec 28, 38) are
  one click away from any Room page.
- `requirements.md` is unchanged: this is still the navigational index over
  Tags of spec 10, not the Glossary entity of FR-N3/FR-N4, and maps have no
  `FR-` yet.

## Decisions

Defaults picked on 2026-10-25 from the request, to confirm in the PR.

1. **Where the tab is**: on every Room-scoped page (the pages `PageLayout`
   gets a `roomId` for: Documents, a Document, maps list, a map, mention
   map), fixed to the left edge of the screen, vertically at about 40% of
   the viewport so it stays above the lower half a map page gives to a
   Document on a phone (spec 37). It does not scroll with the page and does
   not slide away with the header.
2. **What the tab looks like**: a narrow pill attached to the edge (rounded
   on the right only), surface color with the default border, and a
   horizontal arrow (product owner, 2026-10-25, replacing a list icon):
   pointing right while closed (expand), turned to point left while open
   (collapse). From the `sm` breakpoint it also shows the word "Index"
   written vertically; on a phone it is the arrow only, narrower, so it
   covers as little content as possible. It stays muted text color, open or
   not, and only brightens on hover: no accent red (product owner,
   2026-10-25: too aggressive). Its accessible name is "Open Room Index" /
   "Close Room Index".
3. **What the click opens** (product owner, 2026-10-25: "La card è
   compatta in larghezza, ma occupa l'interezza della height dello
   screen"): a card **narrow in width (260px) and as tall as the whole
   screen** (`100dvh`), sliding out from the left edge; the tab rides on
   its right side while it is open, so a second click closes it. Its list
   scrolls inside the card when it is longer than the screen. A click
   outside, Escape or picking an entry also closes it. On a phone the card
   keeps the same width (at most 85% of the screen), so the page stays
   visible beside it.
4. **Same sections as today, in the same order**: the Room's Main items in
   the Documents page's order ("Main Tags"), then the other Tags by
   category, uncategorized last ("Other Tags"), each linking to the
   Documents list filtered by its Tag or Tags. "No Tags in this Room." still
   shows when there are none, above the Maps section.
5. **The Maps section, last**: titled "Maps", it opens with an "All maps"
   link to the Room's maps page, then every map the viewer may see
   (`GET /rooms/{id}/maps`, already filtered by visibility on the backend,
   so nothing new to filter), alphabetical, each linking to the map. With
   no map, only "All maps" is listed.
6. **The burger goes**: the header no longer has a burger; on a Room page
   its left column holds only the back arrow.
7. **Title**: the card is titled "Room Index" ("Indice della Stanza"),
   since it is no longer only Tags.
8. **Data loads on open**: Tags, Main items and maps are fetched only once
   the card is first opened, as the drawer does today.
9. **Not in scope**: other sections (members, setup, search), counts next
   to the entries, remembering the open state, a drag-to-open gesture.

## Design (frontend only, no backend change, no migration)

- `components/RoomIndex.tsx` replaces `GlossaryIndexDrawer.tsx`: owns the
  open state, renders the tab and the full-height card (a Mantine `Drawer`
  on the left, `size` 260px, no overlay blur, title "Room Index", with the
  tab moving to the card's right edge while open); the Tag groups come from `groupTagsByCategory`
  (unchanged), the maps from `useMaps(roomId, opened)`.
- `PageLayout` renders `<RoomIndex roomId>` when given a `roomId`;
  `AppHeader` drops the `Burger`, its state and the drawer.
- `index.css`: `.room-index-tab` (fixed, `left: 0`, `top: 40%`, z-index
  between the header's 100 and Mantine overlays' 200, so modals cover it;
  while open it sits beside the card, above the drawer's overlay), the
  vertical label `.room-index-tab-label` (`writing-mode: vertical-rl`), the
  arrow `.room-index-tab-arrow` turned 180° while open, muted text color
  that brightens to primary text on hover, never the accent red.
- i18n, all 12 languages: `glossary.title` becomes "Room Index",
  `glossary.openToggle` / `closeToggle` "Open / Close Room Index", new
  `glossary.tab` ("Index") and `glossary.allMaps` ("All maps"); the Maps
  section title reuses `maps.title`. The drawer's strings, still hardcoded
  in Italian, move to these keys.
- Docs: `ui-context.md` (header's left column, the Glossary Index bullet),
  `progress-tracker.md`.

## Tests

- `RoomIndex.test.tsx` (from `GlossaryIndexDrawer.test.tsx`): the current
  Tag cases through the tab; the Maps section lists "All maps" and each map
  alphabetically with its link; with no map only "All maps"; picking an
  entry closes the card; nothing is fetched before the first open.
- `layout.test.tsx`: a Room page shows the tab and no burger; a page
  without a Room shows neither; the tab opens and closes the card.
- Screenshots at desktop and phone width of the closed tab and the open
  card.
