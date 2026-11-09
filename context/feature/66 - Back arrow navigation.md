# 66 - Back arrow navigation

## Goals

- Product owner's report (2026-11-09): "La navigation della back arrow si
  comporta in modo strano, soprattutto ora che abbiamo definito le Sezioni
  custom sulla landing page."
- Analyse how the header's back arrow works today (specs 09, 15, 44 and the
  2026-10-25 trail fix), list where it misbehaves now that Sections exist
  (specs 55, 60, 61), and fix it with one clear rule.
- **Frontend only, no migration, no API change.** Analysis made from the
  code (not yet reproduced in a browser); every finding names the file.

## How back works today

The header's arrow (`AppHeader` -> `useHierarchicalBack`, `lib/backNav.ts`)
is hierarchical, never `navigate(-1)`: it goes to the page's fixed parent
(`backTo` of `PageLayout`), unless the link that opened the page put
`{ from, backStack }` in the navigation state (`useBackState()`); then it
walks that trail, skipping Documents and maps that answer 404, and replaces
the current history entry. The label is the parent's name when back goes to
the parent, the generic "Indietro" when it goes elsewhere.

### Fixed parents (`backTo`)

| Page | Parent (fallback) |
|------|-------------------|
| Rooms list `/rooms`, Account | `/` (Account: `/rooms`) |
| Room landing `/rooms/:id` | `/rooms` |
| Section `/rooms/:id/sections/:sid` | Room landing |
| Documents, Maps, Session 0, Clocks, Room setup | Room landing |
| Document | Documents list (`/documents`) |
| Document map (mention map) | its Document |
| Map | Maps list |

### Who passes the trail (`state={useBackState()}`)

Landing Section cards, Section blocks (maps, Session 0 cards), page cards
and the landing editor, Room cards (setup), Room Index entries, Room title
actions, Maps page cards, map Document cards and linked-map panels, the
mention open menu (`DocumentOpenMenu`), Clock cards, geographic board links,
new map from the mention-map modal.

### Who does not

`DocumentCard` (Documents page, Documents blocks of every Section), search
results (`SearchSpotlight`), `Backlinks`, the split pane's "open as page"
(`DocumentSidePane`), the Session 0 Questions module (`QuestionsModule`,
opens the member's Document), new map / imported map on the Maps page.

## Inconsistencies found

1. **A Document opened from a Section goes back to the Documents list, not
   to the Section** (`DocumentCard.tsx` link has no state; the Documents
   block of a Section reuses it, `SectionBlock.tsx`). The main "strange"
   behaviour: Landing -> Section -> Document -> Back lands on a page the
   user never visited. The Section's own maps and Session 0 cards do come
   back to the Section, so one Section behaves two ways.
2. **Search hits, Backlinks, the split pane's "open as page" and the
   Questions module's Document link** have the same hole: back drops the
   user on the Documents list (or the Document's fallback), whatever page
   they were on, including a map or a Section.
3. **The Room Index extends the trail instead of jumping sideways.** Its
   entries pass `useBackState()`, so Section A -> Index -> Section B puts A
   on B's trail: back goes to A, then to the landing. Hierarchically B's
   parent is the landing. Going round the Index grows the trail and back
   needs several presses to get out.
4. **Deleted (or Master-only-hidden) Sections are not skipped.**
   `backTarget` only knows Documents and maps; a trail place that is a
   Section deleted since (spec 60 allows deleting Sections) lands on the
   "not found" text instead of the next place.
5. **The label is generic as soon as a trail exists** ("Indietro" with no
   destination). On a phone the arrow is icon-only, so the user cannot tell
   whether it goes to the Section, the Documents list or the landing.
6. **Back loses the page state**: scroll position, folded blocks and the
   Master's edit mode of a Section/landing are local state, so coming back
   from a Document shows the Section at the top, folded as configured. Not
   a bug of the trail itself, but part of why it feels odd.
7. **Header back replaces the history entry** (decided 2026-10-15 so the
   arrow and the browser's Back never ping-pong). Consequence worth knowing:
   after the arrow, the browser's Forward button no longer returns to the
   page just left. Kept as is.
8. **Mobile**: same header and same logic, no separate behaviour; the
   phone's system Back is the browser's history (it leaves the page it was
   replaced from), so it can differ from the arrow by design. The icon-only
   arrow makes inconsistencies 1, 2 and 5 more visible there.

## Decisions (proposed, to confirm)

1. **One rule**: any link that opens a Document, map, Session 0, Clocks or
   Section page from another page of the Room carries the trail. Only the
   Room's top level (QuickNav menu, brand, the Rooms list) starts a fresh
   one. Centralise it: `DocumentCard`, `SearchSpotlight`, `Backlinks`,
   `DocumentSidePane` and `QuestionsModule` call `useBackState()` like the
   others, and a test walks every opener so a new link cannot forget it.
2. **Index entries are sideways jumps**: they pass the current page's own
   trail unchanged (`readTrail(state)`), not the current page added to it,
   so Section A -> Index -> Section B -> back goes where A's back went (the
   landing). Index from a Document or map page still works the same way.
3. **Sections join `backTarget`** (a `sections` read, already cached by
   `useRoomSections`), so back skips a deleted Section like a deleted
   Document; the last stop is still the page's parent.
4. **Label names the destination** when known: the Section's title, the
   Document's name, the map's name, "Documenti", "Mappe", the Room name for
   the landing. Resolved from the query cache when present, else the
   generic "Indietro". Icon-only on phone, so it is the `aria-label` and
   `title`, as today.
5. **Edit mode and scroll are not restored** in this ticket (see Q2).
6. Header back keeps replacing the history entry (inconsistency 7).

## Open questions for Andrea

- **Q1** Is decision 1 right for search results too? Option A (recommended):
  search from a Section, open a Document, back returns to the Section.
  Option B: search is a "jump", so back goes to the Document's parent.
- **Q2** Restore scroll position and the Section's edit mode when back
  returns to a Section/landing? Recommended: scroll yes (small, in
  `useHierarchicalBack` via the location key), edit mode no. Either can be a
  separate 66c.
- **Q3** Label with the destination's name (decision 4, recommended) or keep
  the generic "Indietro" everywhere?

## Units

- **66_1** Trail on every opener (decision 1) + the all-openers test, ~1 h
  of Claude build time.
- **66_2** Index sideways jumps, Sections in `backTarget`, destination
  label (decisions 2 to 4), ~1.5 h.
- **66_3** (only if Q2 says yes) scroll restore, ~1 h.

## Tests

- `backNav` unit: sideways state keeps the trail; Section paths resolve in
  `backTarget`.
- Page tests: Documents-block card, search hit, backlink, split pane link
  and Questions link arrive with the trail; Landing -> Section -> Document
  -> back -> Section -> back -> Landing; Section A -> Index -> Section B ->
  back -> landing; deleted Section skipped; label per destination.
