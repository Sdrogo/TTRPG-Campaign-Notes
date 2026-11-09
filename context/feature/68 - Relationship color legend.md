# 68 - Relationship color legend

## Goals

- Product owner's request (2026-11-09): "voglio creare un sistema che
  permetta di associare ai diversi colori delle Relazioni nelle Mappe un
  significato, con relativa leggenda a schermo di tutte le diverse
  associazioni di colore delle Relazioni (una sorta di Glossario: Rosso -
  Avversario, Verde - alleato, Rosa - interesse amoroso etc..)". That is:
  give each relation color of a map a meaning, and show on screen a
  **legend** listing every color with its meaning.
- Today a relation's color (spec 28 Decision 8, the fixed palette
  `MAP_COLORS` of 17 colors) means nothing in the app: the reader has to
  guess, or the Master writes a text card by hand. This ticket makes the
  meaning part of the map.
- Order of work set by the product owner: (1) this ticket, confirmed;
  (2) a mock-up (HTML prototype and desktop/phone screenshots in the
  project files, like `clock-prototype/`), approved; (3) the build.
- Needs **one migration** (a nullable column on `relationship_maps`).
  `requirements.md` is not touched.

## Decisions

*Defaults proposed on 2026-11-09, to be confirmed by the product owner (see
Open questions).*

1. **One legend per map.** Each free map (spec 28) has its own legend: a list
   of `color → meaning` pairs, at most one meaning per palette color (so at
   most 17 entries). Maps are free boards (spec 28 Decision 1), so red can
   mean "Adversary" on one map and "Blood debt" on another. Colors without
   a meaning are simply not in the legend.
2. **A meaning** is plain text, 1-40 characters after trimming ("Avversario",
   "Interesse amoroso", "Debito di sangue"); written by the user, never
   translated. Emptying the field removes the entry. The `default` color
   (the theme's text color) can have a meaning too ("Neutrale").
3. **Relations only.** The legend describes the color of the **relations**
   (arrows and plain lines), as asked. The colors of cards, text, labels and
   groups are not covered (see Open question 2).
4. **Legend order** follows the palette (`MAP_COLORS`: default, red, green,
   purple, ...), so it is stable and needs no reordering UI.
5. **Who edits**: whoever may move a card on the map (spec 42: the Master and
   the map's creator, plus every member who sees it when "players can edit"
   is on). Everyone who sees the map reads the legend. The legend is one
   value saved with the board and synced live like the rest (Decision 11).
6. **Where it shows on a desktop** (the map page, `RelationshipMapPage`):
   a small **"Legenda" panel docked at the board's bottom-right corner**
   (the zoom controls are bottom-left, the toolbar top-left, the hint bars
   bottom-center). Each row is a short line sample in that color, drawn like
   a relation (2 px stroke, 28 px long), and the meaning; the color's name
   ("Rosso") is the row's tooltip and accessible name, so the legend does not
   rely on color alone. The panel folds to a chip "Legenda (3)" with a
   chevron; open or folded is remembered per map in the browser
   (`localStorage`, wrapped in try/catch). It starts **open** when the
   legend has entries. It scrolls past ~8 rows (max height about 40% of the
   board) so it never covers the board.
7. **On a phone** (below `sm`, where the free board is read-only today):
   only the **chip "Legenda (3)"** shows, at the board's bottom-right; a tap
   opens a bottom sheet (Mantine `Drawer`, position bottom) with the same
   rows. The phone is read-only for the legend too, as for the board (see
   Open question 5).
8. **Empty state.** With no entries, viewers who can't edit see **nothing**
   (no empty panel). Editors see the folded chip "Legenda" with a `+`;
   opening it shows "Nessun colore ha ancora un significato" and the
   "Modifica legenda" button.
9. **Editing the legend**: the panel's pencil (editors only) opens the
   dialog "Legenda dei colori". It lists, first, **the colors already used by
   the map's relations** (each with its line sample, the color's name and a
   text field, empty when it has no meaning yet), then the other colors that
   already have a meaning, then "Aggiungi colore" (the palette picker,
   `MapColorPicker`, offering only the colors not listed). Each row has a
   remove button. "Salva" saves the whole legend at once; "Annulla" drops the
   changes. Validation: 40 characters, same meaning twice is allowed.
10. **The relation dialog** (`ArrowDialog`) helps pick by meaning: each swatch
    of its color picker gets the meaning as tooltip ("Rosso: Avversario"),
    and under the picker one line shows the chosen color's meaning, or, for
    an editor, "Nessun significato" with a "Modifica legenda" link that
    opens the legend dialog (the relation dialog stays open underneath).
    Changing a relation's color never changes the legend, and editing the
    legend never recolors a relation: existing maps keep every color
    exactly as it is, they just gain an empty legend.
11. **Highlight by meaning** (viewers too, frontend only): a click on a
    legend row keeps that color's relations at full strength and fades the
    others (opacity 0.2) and their labels; cards stay as they are. The row
    shows as selected; a click on it again, on the empty board or `Esc`
    clears it. Nothing is saved. (See Open question 3.)
12. **Live updates** (spec 43/52): the legend travels with the map detail
    the server already pushes after a board save, so other editors and
    viewers see a changed legend without a reload. Two people saving the
    legend at the same time: the last save wins (the dialog saves the whole
    legend), as for a card's dialog.
13. **Master-only relations** (spec 28 Decision 5) do not hide legend
    entries: the legend is visible to everyone who sees the map, so a
    meaning used only by secret relations is still readable. The editor
    dialog says so in a hint ("La legenda è visibile a chi vede la mappa").
14. **Export, import, duplicate**: the map JSON export (spec 40) writes
    `color_legend` at the map level (omitted when empty); import reads it as
    optional, so older files and the Obsidian import (spec 65) still work and
    the export format version does not change. An unknown color or a meaning
    over 40 characters is a validation error, as for other map fields.
    Duplicating a Room (spec 33) or a map copies the legend with the map
    (same transfer code).
15. **Other map kinds**: mention maps (spec 36) draw every relation in one
    color and are not edited, so they get no legend. Geographic maps
    (spec 38) also have colored links: they are left out of this ticket (see
    Open question 1); the column lives on `relationship_maps`, so adding
    them later needs no new migration.
16. **Small boards on a Document page** (the linked map of spec 36
    Decision 15) show the legend as the folded chip only, read-only.
17. **Languages**: every new string in the 12 UI languages (`en`, `it`,
    `de`, `es`, `fr`, `ja`, `ko`, `nl`, `pl`, `pt-PT`, `ru`, `zh-Hans`); the
    color names reuse the existing `maps.colors.*` keys.
18. **Demo** (spec 45): one demo map gets a three-entry legend (e.g. red
    "Rivale", green "Alleato", pink "Interesse amoroso", in each demo
    language) so the feature is visible there.

## Design

- **Migration** (new revision after `d4a8f2c6b9e1`): `color_legend JSONB
  NULL` on `relationship_maps`, a JSON object `{"red": "Avversario",
  "green": "Alleato"}` (keys: palette color names; values: meanings). `NULL`
  or `{}` means no legend. Additive and nullable, so old code keeps working
  while it is applied. Validation lives in the API and domain (the keys must
  be `MapColor` values, 1-40 characters per value, at most 17 keys), not in a
  CHECK. To apply by hand on the staging database before the PR merges into
  `staging`, and on production before the release to `main` that ships it
  (progress tracker → Migrations and Releases).
- **Backend**: `RelationshipMapRow.color_legend`, the `RelationshipMap`
  domain object and `MapDetailResponse` gain `color_legend: dict[MapColor,
  str]` (empty when none). Saving: `PUT` and `PATCH .../board` accept an
  optional `color_legend` (omitted = unchanged, `{}` clears), checked by
  `get_editable_map` like any board change (403 without edit rights, 409 on a
  non-free map). A new domain function cleans it (trim, drop empty values,
  reject unknown colors and over-long meanings with a translated 422).
  `push_map` already sends the whole detail. `map_transfer` /
  `map_transfer_repo` export, import and copy it. No user id is stored, so
  `account_repo.erase_personal_rows` is unchanged.
- **Frontend**: `RelationshipMap.colorLegend` in `types/map.ts` and the API
  mapping in `lib/maps.ts`; a new `MapLegend` component (panel, chip, phone
  drawer) rendered in a React Flow `Panel position="bottom-right"` inside
  `MapBoard`; a `MapLegendDialog`; `MapColorPicker` takes an optional
  `meanings` prop for the tooltips; `ArrowDialog` shows the meaning line;
  `MapArrow` takes a `faded` flag for the highlight (Decision 11). Strings
  under `maps.legend.*` in all locales.
- **Docs when built**: `ui-context.md` (Relationship maps: legend),
  `architecture.md` (the column, the JSON format), the progress tracker
  (migration chain and pending lists).
- **Build units**: 68_1 migration and backend; 68_2 legend panel, phone
  chip and drawer, legend dialog; 68_3 relation dialog meanings and the
  highlight; 68_4 export/import/duplicate, demo, docs.

## Tests

- Backend: the legend round-trips through `PUT` and `PATCH .../board` and
  the map detail; omitted leaves it unchanged, `{}` clears; unknown color,
  empty after trim (dropped), 41 characters (422); a player without edit
  rights gets 403, with "players can edit" on succeeds; a geographic or
  mention map refuses it (409); export writes it only when set, import
  accepts files with and without it and rejects bad values; Room and map
  duplication copy it.
- Frontend: `MapLegend` hides itself for viewers when empty and shows the
  `+` chip for editors; rows follow palette order; fold state is remembered
  and survives a `localStorage` that throws; the phone chip opens the
  drawer; the dialog lists used colors first, adds and removes rows, saves
  the whole legend; `ArrowDialog` shows the meaning and the "Modifica
  legenda" link only to editors; a click on a row fades the other colors
  and a second click, the empty board or `Esc` clears it.
- Frontend CI's 100% branch coverage and `tsc -b` hold; backend 100%.

## Open questions (proposed defaults in bold)

1. Geographic maps have colored links too: give them the same legend?
   **Not in this ticket; a follow-up can reuse the same column.**
2. Should the legend also explain the colors of **cards and groups** (in the
   coterie example, contacts in green and enemies in red)? **No: relations
   only, as asked.** A later option could be a second section "Schede".
3. Highlight by meaning (Decision 11): include it now? **Yes, frontend
   only, small.**
4. One legend per map, or one per Room shared by all its maps?
   **Per map** (maps are free boards); duplicating a map carries its legend.
   A later "copy the legend from another map" button is possible.
5. Edit the legend from a phone? **No, read-only on the phone like the
   board** (the dialog itself would work there, if wanted).
6. Desktop panel open by default when the legend has entries? **Yes,
   remembered per map once folded.**
7. Show the legend entries of colors no relation uses (a legend prepared in
   advance)? **Yes, all entries show; the editor dialog marks unused ones
   "non usato".**
