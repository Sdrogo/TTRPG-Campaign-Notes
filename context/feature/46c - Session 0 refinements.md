# 46c - Session 0 refinements

## Goals

- Product owner's feedback on the Session 0 page (2026-10-27, after PR #251):
  1. "L'indice non deve essere visibile al di fuori della RoomDocumentsPage."
  2. "Il timer nella pagina della Sessione 0 ha una UI dispersiva. Voglio che
     sia compatto e sulla stessa linea del titolo."
  3. "Voglio sia possibile eliminare una sessione 0 per crearne una nuova da
     zero successivamente."
  4. "Voglio eliminare la colonna Domande tra le colonne di default."
  5. "Voglio che le colonne della Retro e le Linee e veli siano più
     accattivanti a livello di UI e che abbiano delle colorazioni che
     rappresentino il senso della colonna (Semaforo), alla creazione."
  6. "Voglio che linee e veli si possano creare senza passare da un Post-it."
  7. "Voglio che i post-it abbiano una UI meno piatta, con una certa
     elevazione."
  8. "Voglio che la pubblicazione sia più facilitata, la UI attuale sembra
     poco evidente. Che ci sia un modo per pubblicare tutto in una sola
     volta."
  9. "Voglio che ci sia modo di raggruppare più post-it che risultino
     collegati."
  10. (2026-10-27, after the first build) "Il Div di linee e veli dovrebbe
      poter essere ridimensionato. Le colonne si dovrebbero adattare alle
      dimensioni dello schermo."
- Everything else in spec 46 stays as decided.

## Decisions

Proposed by Claude on 2026-10-27 and confirmed by the product owner the same
day (6 on a decision card; 5 amended: custom colours from the maps'
palette). The ticket is confirmed.

1. **Room Index only on the Documents page** (amends spec 44): the Index
   tab on the left edge shows on `/rooms/:roomId/documents` only. Every
   other Room page (Document, maps, setup, Session 0) loses it; the
   header's back button and the Room title menu stay the way there.
   The Index keeps its Session 0 entry.
2. **Compact timer on the title line**: the title row reads "Sessione 0"
   then, on the same line, a small chip with the clock icon and the time
   left (`9:58`, "In pausa", "Tempo scaduto"). For the Master the chip is
   the button that opens the timer menu (same items as today); with no
   timer the Master sees only the clock icon, a Player sees nothing. The
   bar under the title goes, and the timer is no longer sticky.
3. **Delete the Session 0** (Master only): "Elimina Sessione 0" in a "⋮"
   beside the title. A confirmation dialog says what goes: every round,
   post-it (drafts included), reaction, group, Lines & Veils and the timer.
   Afterwards the page is "not started" again and any member can start a
   new one from scratch. Not undoable, not audited (as spec 46 Decision 14).
   Every open page is told (live event `reset`).
4. **Three preset Retro columns**: "Lo vogliamo al tavolo", "Con cura",
   "Da evitare". "Domande" goes from new Session 0s and new rounds started
   from scratch; existing Session 0s keep their columns.
5. **Column colours, traffic light**: every column has a colour from the
   relationship maps' palette (spec 28 Decision 8, `MapColor`: default,
   red, green, purple, blue, gold, orange and the others; product owner,
   2026-10-27: "usa la palette che abbiamo fornito per la definizione delle
   relazioni sulle Maps"). The traffic light is green, gold and red.
   - Presets: "Lo vogliamo al tavolo" green, "Con cura" gold, "Da
     evitare" red.
   - Lines & Veils, fixed: Must green, Veils gold, Lines red. The board's
     order becomes Must, Veils, Lines (from the softest to the hardest
     limit) so it reads like a traffic light.
   - A new Retro column: the Master picks the colour when creating it
     (default `default`, the neutral text colour) with the maps' colour
     picker, and can change it from the column's "⋮" ("Colore").
   - A new round copies each column's colour with its title.
   - Look: a coloured band on top of the column, the column's background
     lightly tinted, its post-its tinted with the same colour (a tint mixed
     from the palette colour, so it works in light and dark mode).
6. **Lines & Veils written directly**: each Lines & Veils column gets
   "Aggiungi" at the bottom. **Only the Master** writes there (as only the
   Master promotes, spec 46 Decision 8); the post-it is published at once
   (no draft), signed by the Master, and the Master can edit and delete it.
   A Player who wants a new limit writes it on the Retro board (anonymous
   if they wish) and the Master promotes it (product owner, 2026-10-27:
   "Solo il Master").
7. **Post-its with elevation**: a sticky-note look: the column's tint as
   background, a soft shadow that grows on hover, a slightly larger corner
   radius. A draft stays recognisable: dashed border, no shadow, lighter.
8. **Easier publishing**:
   - A draft shows a visible **"Pubblica"** button on the post-it itself,
     not only in the "⋮".
   - Above the Retro board, while the viewer has drafts in the open round,
     a **"Pubblica tutte le bozze (N)"** button opens the same dialog as
     one post-it, with the anonymous switch applying to all of them.
     Drafts that would go past the 200 post-it limit stay drafts and the
     dialog says how many.
9. **Groups of post-its** (Retro board, Master only):
   - The Master drags a published post-it onto another in the **same
     column**: they become a group (or it joins the other's group). On a
     phone, the post-it's "⋮" has "Raggruppa con…", listing the column's
     other post-its and groups.
   - A group is a framed stack in the column with an optional title the
     Master edits ("Gruppo" when empty) and a count. Each post-it in it
     keeps its own text, author, reactions and actions; the Master can
     take one out ("Togli dal gruppo"); "Sciogli gruppo" ungroups all.
     A group left with one post-it dissolves.
   - Drafts can't be grouped. Groups stay inside a column: no grouping
     across columns or on Lines & Veils. Promoting stays per post-it.
   - Groups belong to their round's column: a new round starts without
     them; deleting the column or the post-its removes them.

10. **Resizable Lines & Veils** (confirmed by the product owner
    2026-10-27): on a screen wide enough for both boards
    (from 62em), a vertical handle between the Retro board and Lines &
    Veils; dragging it widens one board and narrows the other. Lines &
    Veils stays between 280px and 60% of the page; it starts at a third.
    The handle works from the keyboard too (a focusable separator: arrows
    move it, Home/End go to the limits) and a double click puts it back to
    a third. The width is remembered in this browser only, for this
    viewer (not shared, not stored on the server). On a phone nothing
    changes: the two boards stay two tabs.
11. **Columns that fit the screen** (confirmed 2026-10-27):
    - Retro columns share the board's width equally instead of a fixed
      260px, each at least 220px; when the round has more columns than fit
      at 220px, the board scrolls sideways as today. The "Add column"
      button keeps its small width at the end.
    - Lines & Veils columns sit side by side (Must, Veils, Lines) when the
      board is wide enough for three of 220px, and one under the other
      when it isn't, so widening it with the handle lays them out in a
      row.
    - On a phone a Retro column takes the screen's width (less the page
      margins), so one column shows at a time and the board scrolls
      sideways to the next.

## Design

### Backend (46c_1)

- Migration (one): `session_zero_columns.color` (`String(10)`, default
  `default`, validated against `MapColor` like the maps' colours); new table
  `session_zero_groups` (`id`, `column_id` FK cascade, `title` null,
  `created_at`; RLS + deny policy like the other Session 0 tables);
  `session_zero_cards.group_id` FK `ON DELETE SET NULL`. Lines & Veils
  colours come from `kind` in the API, not stored. Existing preset
  columns on staging keep `default`.
- `PRESET_COLUMN_KEYS` loses `questions`; each preset carries its colour.
  The `questions` translation stays unused (or is removed from the 12
  backend locale files).
- Routes under `/rooms/{id}/session-zero`, each answering with the boards:
  - `DELETE` (Master): deletes the `session_zero` row and everything
    under it; live event `reset`.
  - `POST /columns` and `PATCH /columns/{id}` take `color`.
  - `POST /cards` accepts a Lines & Veils `column_id` from the Master:
    published at once, `source_card_id` null, editable by its author.
  - `POST /cards/publish-all` `{anonymous}`: the viewer's drafts in the
    open round, oldest first, up to the board limit; answers with how many
    were published and how many stayed.
  - `POST /groups` `{card_ids}` (Master, ≥ 2 published post-its of one
    Retro column of the open round; joins an existing group if one card
    already has one), `PATCH /groups/{id}` `{title}`, `DELETE
    /groups/{id}` (ungroup), `POST /cards/{id}/ungroup`.
- The board response: each column has `color`; each Retro column lists
  `groups` (`id`, `title`); each post-it has `group_id`.
- Rules in `app/domain/session_zero.py`; shared writes bump `revision` and
  push (`group`, `reset`, existing kinds).

### Frontend (46c_2)

- `PageLayout` gets an explicit `showIndex` used only by
  `RoomDocumentsPage` (Decision 1); tests of other pages lose the Index.
- `SessionZeroTitle`: title, timer chip (`TimerChip`, replaces
  `TimerBar`; its custom-length dialog closes only once the write
  succeeds, review of PR #251), Master "⋮" with "Elimina Sessione 0".
- Column colours through `colorValue` (`lib/maps.ts`) and the existing
  `MapColorPicker`; tints with `color-mix()`; `ui-context.md` documents
  the look.
- `PostItCard` restyle (Decision 7) and the inline "Pubblica" button;
  "Pubblica tutte le bozze" above the Retro board.
- `PostItGroup` component; drop on a post-it groups (same native drag
  payload, `action` checked against the column); "Raggruppa con…" modal.
- Lines & Veils "Aggiungi" for the Master with the same `PostItEditor`.
- Strings in 12 languages.
- Decisions 10 and 11 (frontend only, no migration): a
  `BoardsSplit` component with a `role="separator"` handle
  (`aria-valuenow` in percent, pointer events for mouse and touch, keys);
  the width in `localStorage` (wrapped in try/catch, a per-viewer
  convenience). Retro columns `flex: 1 1 0` with `min-width: 220px`
  (phone: `calc(100vw - margins)`); Lines & Veils columns in a CSS grid
  `repeat(auto-fit, minmax(220px, 1fr))`. `ui-context.md` documents both.

## Tests

- Backend: delete Session 0 is Master only and wipes everything, after
  which `GET` answers not started and `start` creates a fresh one with three
  coloured presets; colours on create, rename and new round; direct Lines &
  Veils post-its Master only (403 for a Player), published, editable;
  publish-all publishes only the viewer's drafts of the open round and
  respects the limit; groups Master only, same column, published only,
  joining, ungroup, dissolve at one, gone in a new round; events emitted.
- Frontend: Index only on the Documents page; timer chip states; delete
  dialog; colour picker; inline publish and publish-all; group drag and
  "Raggruppa con…"; Lines & Veils "Aggiungi" only for the Master.

## As built

- 46c_1 (backend): migration `c3f8a1d6e9b4`; `app/domain/session_zero.py`
  (`LINES_VEILS_COLORS`, `Column.shown_color`, `Group`, `can_group`,
  `ensure_can_group`, `clean_group_title`, `publishable_count`,
  `ensure_can_add_card` taking the role); `app/db/session_zero_repo.py`
  (groups, `prune_groups`, `publish_cards`, `delete_session_zero`,
  `update_column`); routes in `app/api/session_zero.py`. New error keys
  `notGroupable`, `groupNotFound`, `nothingToChange` in 12 languages; the
  `questions` preset string is gone. `POST /groups` merges every group its
  post-its already belong to into the first post-it's.
- 46c_2 (frontend): `PageLayout`'s `showIndex`;
  `components/sessionZero/SessionZeroTitle.tsx` (title, `TimerChip`,
  delete; replaces `TimerBar.tsx`), `PostItGroup.tsx`, `PostItCard.tsx`
  (tint, inline Publish, drop to group, "Group with…", "Take out of the
  group", `PublishModal` shared with "Publish all"), `BoardColumns.tsx`
  (colours, "Colour" dialog, Lines & Veils "Add"); styles `.sz-column`,
  `.sz-post-it`, `.sz-group` in `index.css`. The board context's `act`
  takes an `onDone`, so a dialog closes only once its write succeeds.
- Decisions 10 and 11: `components/sessionZero/BoardsSplit.tsx` (handle,
  `localStorage` key `sessionZero:linesVeilsWidth`); `.sz-retro-column`,
  `.sz-retro-scroll`, `.sz-lines-veils`, `.sz-split-handle` in
  `index.css`; string `sessionZero.resize` in 12 languages.
- Screenshots: `session-zero/` in the project files.

## Build estimate

Claude's build time: 46c_1 and 46c_2 in one session. One migration, to apply
to the staging database before merging and to production before the
release. 46_4 (live client) follows, or comes first if the product owner
prefers.
