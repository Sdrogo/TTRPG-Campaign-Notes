# 77b - Area color legend

## Goals

- Product owner's request (2026-11-27, same thread as ticket 77): "Vorrei
  anche introdurre una leggenda per le Aree in maniera similare a quanto
  fatto per la leggenda delle relazioni". That is: on a geographic map
  (spec 38), give each **area color** a meaning ("Rosso: Yakuza", "Blu:
  Polizia", "Grigio: Zona neutrale") and show the legend on screen, the way
  spec 68 does for the relations of a free map.
- Spec 68 Decision 15 left geographic maps out "for now" and put the
  meanings on `relationship_maps`, so this needs **no migration**: the
  columns `color_legend` and `legend_preset_id` and the presets table
  already exist and are simply used for geographic maps too.
- Goes with ticket 77 (several areas per Document): with patchwork
  territories, a color legend is what tells the reader which patches belong
  together. Built on the same branch and PR, after 77.

## Decisions (proposed 2026-11-27, confirm in the PR)

1. **Same model as spec 68**: one legend per geographic map, a meaning
   (1-40 characters) per palette color, at most 17; own meanings **or** a
   link to one Room preset; Master manages presets, editors apply them;
   applying replaces with a warning; a linked map follows the preset live.
   Everything of spec 68 Decisions 2, 5, 6, 10, 13, 19-25 applies as
   written, with "relation" read as "area".
2. **Areas only** (*proposed*, see Open question 1). The legend describes
   the color of the **areas**. Pins and links of a geographic map are not
   covered.
3. **Only colors in use are shown** (spec 68 Decision 4): a row shows when
   at least one area **the viewer sees** has that color and the map has a
   meaning for it. A color used only by Master-only areas, or only by areas
   of a Document hidden from a Player, never shows to that Player, so the
   legend reveals nothing hidden (Invariant 1).
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
8. **Presets are shared** (*proposed*, see Open question 2): the Room has
   one list of presets, used by free maps for relations and by geographic
   maps for areas. A preset is only colors and meanings, so nothing stops
   applying the same one to both kinds; the "Gestisci preset" list shows how
   many maps of each kind use it.
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
  geographic maps too. Tests: a Player's map detail and export of a map
  with a color used only by hidden areas (the meaning is still in
  `color_legend`, Decision 3 filters on the client, as spec 68; see Open
  question 3), legend saved through `/geo`, import/export round trip.
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

## Open questions

1. **Areas only, or pins too?** Proposed: areas only (Decision 2). With pins
   too, one meaning per color would cover both, so a red pin and a red area
   would share "Yakuza".
2. **One list of presets for both kinds of map?** Proposed: yes (Decision 8,
   no migration). Alternative: presets marked "relations" or "areas", each
   offered only on its kind of map (one small migration, a `kind` column).
3. **Meanings of colors a Player can't see**: spec 68 sends all the map's
   meanings and the client shows only the colors in use. On a free map that
   reveals at most a word; on a geographic map a meaning like "Covo segreto
   della Setta" could hint at a hidden area. Proposed: the server leaves out
   of a Player's response (and export) the meanings of colors no visible
   area uses, for geographic maps only; editors still get them all.

## Effort

About **2 hours of Claude's own build time** on top of ticket 77 (mostly
reuse: backend about 45 minutes with tests, frontend about 1 hour, strings,
demo and docs about 15 minutes). No migration.

## Definition of Done

- An editor sets meanings for area colors on a geographic map, by hand or
  from a Room preset; every viewer sees the legend of the colors in use,
  can highlight a color, and a Player never sees a meaning that points at a
  hidden area (per Open question 3).
- The legend travels in the map's JSON export/import, the Room export and
  Room duplication.
