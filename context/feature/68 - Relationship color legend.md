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
  meaning part of the map, and lets the Room keep **presets** (ready-made
  legends) to reuse across its maps.
- Order of work set by the product owner: (1) this ticket, confirmed;
  (2) a mock-up (HTML prototype and desktop/phone screenshots in the
  project files, like `clock-prototype/`), approved; (3) the build.
- Needs **one migration** (a nullable column on `relationship_maps` and a
  presets table). `requirements.md` is not touched.

## Decisions

*Defaults proposed on 2026-11-09; the product owner answered all eleven
open questions the same day (see Answered).*

1. **One legend per map.** Each free map (spec 28) stores its own meanings:
   a list of `color → meaning` pairs, at most one meaning per palette color
   (so at most 17). Maps are free boards (spec 28 Decision 1), so red can
   mean "Adversary" on one map and "Blood debt" on another. A Room can also
   keep presets that maps link to (Decisions 19-25).
2. **A meaning** is plain text, 1-40 characters after trimming ("Avversario",
   "Interesse amoroso", "Debito di sangue"); written by the user, never
   translated. Emptying the field removes it. The `default` color (the
   theme's text color) can have a meaning too ("Neutrale").
3. **Relations only.** The legend describes the color of the **relations**
   (arrows and plain lines). Cards, text, labels and groups are not covered:
   groups already carry a title that explains them (product owner).
4. **Only colors in use are shown** (product owner). The legend lists a
   color only when at least one relation of the map **that the viewer sees**
   has that color **and** the map has a meaning for it. Meanings stored for
   colors no relation uses (typically from a preset) stay saved but hidden;
   as soon as a relation of that color is drawn or recolored, its row
   appears in the legend by itself, with no extra step. Removing the last
   relation of a color hides the row again (the meaning stays saved).
   Because the count is over the relations the viewer sees, a color used
   only by Master-only relations (spec 28 Decision 5) does not show to
   players.
5. **Legend order** follows the palette (`MAP_COLORS`: default, red, green,
   purple, ...), so it is stable and needs no reordering UI.
6. **Who edits**: whoever may move a card on the map (spec 42: the Master and
   the map's creator, plus every member who sees it when "players can edit"
   is on). Everyone who sees the map reads the legend. The meanings are one
   value saved with the board and synced live like the rest (Decision 13).
7. **Where it shows on a desktop** (the map page, `RelationshipMapPage`):
   a small **"Legenda" panel docked at the board's bottom-right corner**
   (the zoom controls are bottom-left, the toolbar top-left, the hint bars
   bottom-center). Each row is a short line sample in that color, drawn like
   a relation (2 px stroke, 28 px long), and the meaning; the color's name
   ("Rosso") is the row's tooltip and accessible name, so the legend does not
   rely on color alone. The panel folds to a chip "Legenda (3)" with a
   chevron; open or folded is remembered per map in the browser
   (`localStorage`, wrapped in try/catch). It starts **open** when it has
   rows (product owner). It scrolls past ~8 rows (max height about 40% of
   the board) so it never covers the board.
8. **On a phone** (below `sm`, where the free board is read-only): only the
   **chip "Legenda (3)"** shows, at the board's bottom-right; a tap opens a
   bottom sheet (Mantine `Drawer`, position bottom) with the same rows.
   Read-only, like the board (product owner).
9. **Empty state.** With no row to show, viewers who can't edit see
   **nothing** (no empty panel). Editors see the folded chip "Legenda" with
   a `+`; opening it shows "Nessun colore ha ancora un significato" with
   "Modifica legenda" and "Applica preset".
10. **Editing the legend**: the panel's pencil (editors only) opens the
    dialog "Legenda dei colori". It lists **the colors the map's relations
    use**, each with its line sample, the color's name and a text field
    (empty when it has no meaning yet). Below, folded, "Significati non usati
    in questa mappa (N)" lists the saved meanings of unused colors (from a
    preset or from relations since removed), editable and removable, so
    nothing hidden is out of reach. The footer has "Applica preset", "Salva
    come preset" (Decision 23), "Annulla" and "Salva"; "Salva" saves all the
    meanings at once. Same meaning on two colors is allowed. On a map linked
    to a preset, the dialog follows Decision 22.
11. **The relation dialog** (`ArrowDialog`) helps pick by meaning: each swatch
    of its color picker gets the meaning as tooltip ("Rosso: Avversario"),
    and under the picker one line shows the chosen color's meaning, or, for
    an editor, "Nessun significato" with a "Modifica legenda" link that
    opens the legend dialog (the relation dialog stays open underneath).
    Changing a relation's color never changes the meanings, and editing them
    never recolors a relation: existing maps keep every color exactly as it
    is, they just start with no meanings.
12. **Highlight by meaning** (viewers too, frontend only; product owner: yes):
    a click on a legend row keeps that color's relations at full strength and
    fades the others (opacity 0.2) and their labels; cards stay as they are.
    The row shows as selected; a click on it again, on the empty board or
    `Esc` clears it. Nothing is saved.
13. **Live updates** (spec 43/52): the meanings travel with the map detail
    the server already pushes after a board save, so other editors and
    viewers see a changed legend without a reload. Two people saving the
    legend at the same time: the last save wins (the dialog saves all the
    meanings), as for a card's dialog.
14. **Export, import, duplicate (map meanings)**: the Room JSON export
    (spec 40) writes `color_legend` on each free map (omitted when empty),
    unused meanings included; import reads it as optional, so older files
    and the Obsidian import (spec 65) still work. An unknown color or a
    meaning over 40 characters is a validation error, as for other map
    fields. Duplicating a Room (spec 33) or a map copies the meanings with
    the map (same transfer code).
15. **Other map kinds**: mention maps (spec 36) draw every relation in one
    color and are not edited, so they get no legend. Geographic maps
    (spec 38) are left out for now (product owner); the column lives on
    `relationship_maps`, so adding them later needs no new migration.
16. **Small boards on a Document page** (the linked map of spec 36
    Decision 15) show the legend as the folded chip only, read-only.
17. **Languages**: every new string in the 12 UI languages (`en`, `it`,
    `de`, `es`, `fr`, `ja`, `ko`, `nl`, `pl`, `pt-PT`, `ru`, `zh-Hans`); the
    color names reuse the existing `maps.colors.*` keys.
18. **Demo** (spec 45): one demo map gets meanings for three colors its
    relations use (e.g. red "Rivale", green "Alleato", pink "Interesse
    amoroso", in each demo language) and the demo Room one preset, so the
    feature is visible there.

### Presets (product owner, 2026-11-09: "per mappa, con possibilità di impostare preset")

19. **A preset** is a named set of `color → meaning` pairs (name 1-60
    characters, 1-17 meanings, same rules as Decision 2), kept by the
    **Room** (product owner), so every map of the Room can use it ("Corte
    vampiri", "Fazioni del porto"). At most 30 presets per Room.
20. **A map either has its own meanings or is linked to one preset**
    (product owner: "resta collegato, un aggiornamento si ripercuote
    ovunque"). A linked map shows the preset's meanings, read live: when
    the preset changes, every map of the Room linked to it shows the new
    meanings, pushed live to whoever has one of those maps open (spec
    43/52). Decision 4 still applies: a linked map lists only the colors its
    relations use, and drawing a relation in a color the preset covers adds
    that row by itself. The legend panel and dialog name the preset
    ("Preset: Corte vampiri").
21. **Applying a preset** ("Applica preset" in the legend dialog or the
    empty legend; anyone who edits the map): a list of the Room's presets,
    each with its colored dots and meanings as a preview. Applying
    **replaces** the map's meanings with the link to the preset (product
    owner); when the map has meanings of its own, a warning says they will
    be dropped ("I 4 significati di questa mappa verranno sostituiti").
    Applying another preset moves the link.
22. **Editing on a linked map**: the Master's "Salva" in the legend dialog
    edits **the preset** itself, and the dialog says so ("Modifichi il
    preset: cambia in tutte le N mappe collegate"). For any other editor the
    meanings are read-only there. Anyone who edits the map can
    **"Scollega"**: the map takes a copy of the preset's meanings as its own
    and the link goes; from then on edits stay on that map.
23. **Saving and managing presets** (Master only, product owner): "Salva come
    preset" in the legend dialog turns the map's own meanings into a new
    preset and links the map to it; "Gestisci preset" lists the Room's
    presets (name, meanings, how many maps use it) to rename, edit or
    delete. **Deleting** a preset never empties a map: each linked map
    first gets a copy of the preset's meanings as its own, then the link
    goes (one transaction).
24. **Presets in duplication and export**: duplicating a Room copies its
    presets and keeps each map's link pointing to the copy; the Room JSON
    export (spec 40) writes them in an optional `map_legend_presets` list
    and a linked map carries `legend_preset` (the preset's name); import
    adds the presets to the Room (a name already there gets " (2)") and
    restores the links. Duplicating a single map keeps its link (same
    Room).
25. **Visibility**: presets are not secret; every member who edits a map of
    the Room sees the list. Players who can't edit any map never see it,
    they only read the meanings on the maps they see.

## Design

- **Migration** (new revision after `d4a8f2c6b9e1`):
  - `relationship_map_legend_presets` (`id`, `room_id` → `rooms`
    `ON DELETE CASCADE`, `name` String(60), `entries` JSONB, a JSON object
    `{"red": "Avversario", "green": "Alleato"}` (keys: palette color names;
    values: meanings), `created_at`, `updated_at`; unique `(room_id,
    name)`); RLS + deny policy like the other tables. No user id is stored,
    so `account_repo.erase_personal_rows` is unchanged.
  - On `relationship_maps`: `color_legend JSONB NULL` (the map's own
    meanings, same shape, unused colors included; `NULL` or `{}` means
    none) and `legend_preset_id UUID NULL` → the presets table `ON DELETE SET
    NULL` (the delete endpoint copies the meanings first, Decision 23);
    `CHECK (legend_preset_id IS NULL OR color_legend IS NULL)`, a map is
    either linked or has its own.
  - Additive, so old code keeps working while it is applied. Validation
    (known colors, 1-40 characters, at most 17 keys) lives in the domain, not
    in a CHECK. To apply by hand on the staging database before the PR merges
    into `staging`, and on production before the release to `main` that
    ships it (progress tracker → Migrations and Releases). Reversible.
- **Backend**: `RelationshipMapRow.color_legend` and `.legend_preset_id`;
  the `RelationshipMap` domain object and `MapDetailResponse` gain
  `color_legend: dict[MapColor, str]` (the **effective** meanings: the
  preset's when linked, else the map's own; empty when none; the client
  filters by the colors in use, Decision 4) and `legend_preset: {id, name} |
  None`. Saving: `PUT` and `PATCH .../board` accept an optional
  `color_legend` (the map's own meanings: omitted = unchanged, `{}` clears;
  refused with 409 while linked) and an optional `legend_preset_id`
  (link to a preset of the same Room, else 404; `null` = "Scollega", which
  copies the preset's meanings into `color_legend`), under
  `get_editable_map` like any board change (403 without edit rights, 409 on
  a non-free map). A domain function cleans meanings (trim, drop empty
  values, reject unknown colors and over-long meanings with a translated
  422). Presets: `GET/POST /rooms/{room_id}/map-legend-presets`,
  `PATCH/DELETE .../{preset_id}` (list for anyone who may edit a map of the
  Room, writes for the Master; 409 past 30 or on a duplicate name); a
  `PATCH` of the entries calls `push_map` for every linked map so open
  boards update live; `DELETE` copies the entries into the linked maps
  first. `map_transfer`, `room_copy` and the Room export/import carry
  meanings, presets and links (optional keys; `SCHEMA_VERSION` unchanged).
- **Frontend**: `RelationshipMap.colorLegend` in `types/map.ts` and the API
  mapping in `lib/maps.ts`, plus `legendRows(map, visibleArrows)` (palette
  order, colors in use only); a `MapLegend` component (panel, chip, phone
  drawer) in a React Flow `Panel position="bottom-right"` inside
  `MapBoard`; `MapLegendDialog` (used colors, folded unused meanings,
  preset name, link and "Scollega"); `LegendPresetsDialog` (pick, save, manage) with a
  `useLegendPresets` query; `MapColorPicker` takes an optional `meanings`
  prop for the tooltips; `ArrowDialog` shows the meaning line; `MapArrow`
  takes a `faded` flag for the highlight. Strings under `maps.legend.*` in
  all locales.
- **Docs when built**: `ui-context.md` (Relationship maps: legend and
  presets), `architecture.md` (the column, the table, the JSON format), the
  progress tracker (migration chain and pending lists).
- **Build units**: 68_1 migration and backend (meanings, presets API, links);
  68_2 legend panel, phone chip and drawer, legend dialog; 68_3 presets UI;
  68_4 relation dialog meanings and the highlight; 68_5
  export/import/duplicate, demo, docs.

## Tests

- Backend: the meanings round-trip through `PUT` and `PATCH .../board` and
  the map detail; omitted leaves them unchanged, `{}` clears; unknown color,
  empty after trim (dropped), 41 characters (422); a player without edit
  rights gets 403, with "players can edit" on succeeds; a geographic or
  mention map refuses them (409). Presets: CRUD for the Master, 403 for a
  player writing, list hidden from members who can't edit any map, 409 at
  31 or on a duplicate name, gone with the Room. Links: linking returns the
  preset's meanings and drops the map's own; own meanings are refused while
  linked; "Scollega" copies them; a preset edit changes every linked map's
  detail and pushes it; deleting a preset leaves each linked map its own
  copy; a preset of another Room is 404. Export writes meanings, presets
  and links only when present; import accepts files with and without them,
  renames a clashing preset, restores links and rejects bad values; Room
  duplication points links at the copied presets.
- Frontend: `legendRows` keeps palette order and only colors used by the
  relations the viewer sees; a new relation in a preset color adds its row;
  `MapLegend` hides itself for viewers when empty and shows the `+` chip
  for editors; fold state is remembered and survives a `localStorage` that
  throws; the phone chip opens the drawer; the dialog lists used colors,
  folds the unused meanings, saves all at once; applying a preset links it
  and warns before dropping the map's own meanings; on a linked map the
  Master's save edits the preset (with the "N maps" notice) and other
  editors see read-only meanings and "Scollega"; saving and managing
  presets; `ArrowDialog` shows the meaning and the "Modifica
  legenda" link only to editors; a click on a row fades the other colors
  and a second click, the empty board or `Esc` clears it.
- Frontend CI's 100% branch coverage and `tsc -b` hold; backend 100%.

## Answered (product owner, 2026-11-09)

1. Geographic maps: **not now**.
2. Card and group colors: **no**, groups already have a title that explains
   them.
3. Highlight by meaning: **yes**.
4. Per map or per Room: **per map, with presets** (Decisions 19-25).
5. Editing from a phone: **no**.
6. Desktop panel open by default when it has rows: **yes**.
7. Meanings of unused colors: **not shown**. Only colors the map uses
   appear; a preset's unused colors are filtered out, and drawing a
   relation in a color the preset covers adds it to the legend (Decision 4,
   20).
8. Presets: **the Master** creates, edits and deletes them; whoever edits
   a map may apply them.
9. Presets **belong to the Room**.
10. Applying a preset **replaces** the map's meanings, with a warning.
11. A map **stays linked** to its preset: editing the preset updates every
    map of the Room that uses it (Decisions 20-23).
