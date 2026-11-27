# 77b - Area color legend

## Goals

- Product owner's request (2026-11-27, same thread as ticket 77): "Vorrei
  anche introdurre una leggenda per le Aree in maniera similare a quanto
  fatto per la leggenda delle relazioni". That is: on a geographic map
  (spec 38), give each **area color** a meaning ("Rosso: Yakuza", "Blu:
  Polizia", "Grigio: Zona neutrale") and show the legend on screen, the way
  spec 68 does for the relations of a free map.
- Spec 68 Decision 15 left geographic maps out "for now" and put the
  meanings on `relationship_maps`: the columns `color_legend` and
  `legend_preset_id` and the presets table already exist and are used for
  geographic maps too. The only schema change is a `kind` on presets
  (Decision 8), in ticket 77's migration.
- Goes with ticket 77 (several areas per Document): with patchwork
  territories, a color legend is what tells the reader which patches belong
  together. Built on the same branch and PR, after 77.

## Decisions

*Proposed 2026-11-27; the product owner answered the open questions the
same day (see Answered). Confirmed.*

1. **Same model as spec 68**: one legend per geographic map, a meaning
   (1-40 characters) per palette color, at most 17; own meanings **or** a
   link to one Room preset; Master manages presets, editors apply them;
   applying replaces with a warning; a linked map follows the preset live.
   Everything of spec 68 Decisions 2, 5, 6, 10, 13, 19-25 applies as
   written, with "relation" read as "area".
2. **Areas only** (product owner). The legend describes
   the color of the **areas**. Pins and links of a geographic map are not
   covered.
3. **Only colors in use are shown, and nothing hidden** (spec 68 Decision 4;
   product owner: "se un'info è nascosta sulla mappa sarà nascosta pure
   nella leggenda"). A row shows when at least one area **the viewer sees**
   has that color and the map has a meaning for it. For a viewer who can't
   edit the map, the **server** leaves out of the map detail, the live
   updates and the export the meanings of colors that no area they see
   uses, so a Player can't read the meaning of a color used only by
   Master-only areas or by a Document hidden from them (Invariant 1).
   Editors get every meaning, to edit them.
4. **The row sample** is a small filled square with the area's outline (16
   px), not the relation's line, so it reads as "a zone of this color". The
   color's name is the tooltip and accessible name, as in spec 68.
5. **Where it shows**: the same panel at the board's bottom-right, open by
   default, foldable to the chip "Legenda (N)", remembered per map; on a
   phone the chip and the bottom drawer, read-only; on a Document page's
   small linked map, the folded chip only (spec 68 Decisions 7-9, 16). Empty
   state as spec 68 Decision 9.
6. **The area dialog** (`AreaDialog`) helps pick by meaning, like the
   relation dialog of spec 68 Decision 11: each swatch has "Rosso: Yakuza"
   as tooltip, one line under the picker shows the chosen color's meaning,
   or "Nessun significato" with a "Modifica legenda" link for an editor.
7. **Highlight by meaning** (viewers too, not saved): a click on a row keeps
   the areas of that color at full strength and fades the other areas
   (opacity 0.2) with their names; pins and links stay as they are. The Tag
   filter (spec 38 Decision 8) and the highlight can be on together: an area
   is faded if either fades it.
8. **Two separate legends, one place to manage them** (product owner: "sì
   se nettamente divise nella UI, in modo che sia chiaro che sono due
   leggende separate"). Every preset has a **kind**, `relations` (all the
   existing ones) or `areas` (`relationship_map_legend_presets.kind`,
   default `relations`, CHECK). "Gestisci preset" shows two clearly
   separate sections, **"Leggende delle relazioni"** and **"Leggende delle
   aree"**, each with its own "Nuovo preset"; a free map offers only
   relation presets, a geographic map only area presets (linking one of
   the other kind: 409). "Salva come preset" makes one of the map's kind.
   The legend panel's title says which legend it is: "Legenda aree" on a
   geographic map ("Legenda" stays on free maps). The preset name stays
   unique per Room and kind.
9. **Export, import, duplicate**: the geographic map's JSON file (spec 38_3,
   still `schema_version` 1) gains an optional top-level `color_legend`
   (`{"red": "Yakuza", ...}`, the meanings it shows, unused ones included;
   omitted when empty); import reads it as optional, so older files work.
   The Room JSON export (spec 40) writes `color_legend` on geographic maps
   as it does on free ones; duplicating a Room keeps the preset link (spec
   68 Decision 24, already generic). The prompt for Claude in another chat
   (spec 38) gets one line on `color_legend`.
10. **Demo**: the demo geographic map gets meanings for the colors of its
    areas, in each demo language.

## Design

- **Backend**: allow `legend` in the geographic board `PUT`/`PATCH`
  (`/maps/{map}/geo`, as the free board's, same rules and 409 while linked);
  the map detail already returns `color_legend` and `legend_preset` for
  every map, so geographic maps get them with no new field. Lift the "free
  map only" check of the legend paths. `map_import.py` reads and writes
  `color_legend` (`clean_meanings`); `map_transfer.py` writes it for
  geographic maps too. Map detail, live push and export filter
  `color_legend` for non-editors of a geographic map (Decision 3); presets
  get `kind` in the API (list, create) and the link checks it (Decision 8).
  Tests: a Player's map detail, live update and export of a map with a
  color used only by hidden areas carry no meaning for it; an editor's do;
  a relation preset can't be linked to a geographic map and the reverse;
  legend saved through `/geo`; import/export round trip.
- **Frontend**: `MapLegend` takes the colors in use and a `sample` kind
  (line for relations, swatch for areas) instead of the free board's
  arrows; `GeographicBoard` mounts it and the highlight; `AreaDialog` gets
  the meanings like `ArrowDialog`; `MapLegendDialog` lists the colors the
  areas use. New strings in the 12 UI languages.
- **Docs**: spec 68 Decision 15 points here; `architecture.md` (legend on
  geographic maps), `ui-context.md` (the area swatch), progress tracker.
- **No mock-up** (*proposed*): the panel, chip, drawer and dialogs are
  those approved for spec 68, only the sample changes. Screenshots in the
  project files after the build.

## Answered (product owner, 2026-11-27)

1. **Areas only, or pins too?** Areas only (Decision 2).
2. **One list of presets?** One place to manage them, but two clearly
   separate legends: presets get a kind (Decision 8).
3. **Meanings of colors a Player can't see?** Hidden on the map means
   hidden in the legend: the server filters them (Decision 3).

## Effort

About **2.5 hours of Claude's own build time** on top of ticket 77 (mostly
reuse: backend about 1 hour with tests, frontend about 1 hour 15 minutes,
strings, demo and docs about 15 minutes). The preset `kind` column rides in
ticket 77's migration.

## Definition of Done

- An editor sets meanings for area colors on a geographic map, by hand or
  from a Room preset; every viewer sees the legend of the colors in use,
  can highlight a color, and a Player never sees a meaning that points at a
  hidden area.
- Relation and area presets are managed in one place, in two clearly
  separate sections, and each map offers only its own kind.
- The legend travels in the map's JSON export/import, the Room export and
  Room duplication.
