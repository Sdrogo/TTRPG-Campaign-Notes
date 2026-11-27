# 77 - Several areas for one Document

## Goals

- Product owner's request (2026-11-27): "vorrei permettere, in una mappa
  geografica, di definire più aree legate ad uno stesso documento. Può
  succedere che parte del territorio di una qualche fazione sia distribuita
  a macchia di leopardo". That is: on a geographic map (spec 38), one
  Document (a faction, a clan, a corporation) may own **several separate
  areas**, a patchwork territory.
- Today a Document is on a geographic map **at most once**, as one area or
  one pin (spec 38 Decisions 3-4). This ticket lifts the rule for **areas
  only**; everything else about areas, pins and links stays as it is.
- Needs **one small migration** (drop a unique constraint, add one map
  setting; ticket 77b adds a preset column in the same migration). No new
  table. `requirements.md` is not touched: D-32 and FR-M4 don't
  state the "once per map" rule, so they stay true.

## Today (what the code does)

- **Database**: `relationship_map_areas` has `UNIQUE (map_id, document_id)`
  (`uq_relationship_map_areas_document`, migration `d7c1f5a9e3b8`);
  `relationship_map_pins` has the same constraint. A Document's areas and
  pins go with it (`ON DELETE CASCADE`), links go with their ends.
- **Rules** (`app/domain/geographic_maps.py`): `plan_geo_board_edit` refuses
  (422) a Document placed twice, counting areas and pins together and the
  places hidden from the editor; `merge_geo_changes` (spec 43, the live
  `PATCH` of spec 42/52) drops a new area or pin for a Document already on
  the map; `geo_document_count` (the Maps list's "N Documents") counts
  every placed item.
- **Import/export** (`app/domain/map_import.py`, spec 38_3): a Document
  named twice in the file fails the import through `plan_geo_board_edit`
  (a generic 422); the export gives each area its own `key`, made unique
  from the name (`_unique_key`). The Room export, import and duplication
  (specs 40 and 33, `map_transfer.py`, `room_copy.py`) copy areas one by
  one, so they already carry several; `MapUpload.document_count` counts
  places, not Documents.
- **Frontend** (`lib/geoMaps.ts`, `components/maps/`): `PlaceDocumentSelect`
  hides every Document already on the map (`placedDocumentIds`);
  `placeOfDocument` returns **one** place, used by `RelationshipMapPage` to
  select on the map the Document open in the split pane (spec 50); a click
  on an area selects that area only.

## Decisions

*Proposed 2026-11-27; the product owner answered the open questions the
same day (see Answered). Confirmed.*

1. **Many areas, one pin.** A Document may have **any number of areas** on
   a geographic map (within the map's cap of 60 areas, Decision 11 of spec
   38, unchanged). A pin stays **at most one** per Document per map.
2. **Areas or a pin, never both** (product owner: "solo aree al momento"). A
   Document placed as a pin can't get an area on the same map and the
   reverse, as today. A faction's headquarters is usually a Document of its
   own (a place), which can be a pin next to the faction's areas.
3. **Each area is its own item.** Every area keeps its own shape, color,
   dashed and filled flags, and its own links (a link joins two **areas or
   pins**, not two Documents). Name and subtitle follow the Document on
   every area, as today. Visibility is per area as today (Invariant 1): a
   hidden Document hides all its areas and every link touching them.
4. **Creating, both ways** (product owner). (a) When an area bound to a
   Document is selected in editing mode, its card gets an **"Add an area"**
   button ("Aggiungi un'area"): it starts drawing a new area bound to the
   same Document. (b) Any **existing** area (a plain one, or one bound to
   another Document) can be bound in its dialog to a Document that already
   has areas: the Document picker offers every Document except those placed
   as a **pin**, with "(already on the map)" next to those with areas.
4b. **One color per Document** (product owner): all the areas of a
   Document on a map share **the same color**. A new or newly bound area
   takes the color of the Document's **first** area (the oldest on the map);
   changing the color of any of them recolors all of them, and the area
   dialog says so ("Cambia il colore di tutte le 3 aree di questo
   Documento"). Dashed and filled stay per area. The save refuses (422) a
   Document whose areas have different colors; the JSON import takes the
   first area's color for the others and the report says so.
5. **Names: on every area or only on the largest, chosen per map**
   (product owner: "vorrei che si potesse scegliere"). The "Map" dialog
   (`GeoMapDialog`) gets **"Nomi delle aree con più parti"**: "Su ogni area"
   (default) or "Solo sull'area più grande". With the second, a Document's
   name and subtitle are drawn only on its largest area (by surface; ties go
   to the oldest); the others are unnamed but still show the name as their
   tooltip and accessible name. Plain areas and Documents with one area are
   always named. Stored as `relationship_maps.area_labels` (`every` default
   or `largest`, CHECK; null on free maps), saved through the map `PATCH`
   like the plane, in the map JSON file as optional `area_labels`.
6. **Selecting and highlighting.** A click on one of a Document's areas
   selects that area (for dragging, corners, Delete) and **highlights all
   the Document's other areas** with a softer outline, so the whole
   territory reads at a glance. While reading, a click opens the Document in
   the split pane (spec 37/38b) as today; the Document open in the pane,
   after a reload or a pick there, highlights all its areas
   (`placeOfDocument` becomes `placesOfDocument`, a list). The pin of a
   Document (Decision 2) is unchanged.
7. **Deleting.** Delete removes only the selected area (and its links); the
   Document's other areas stay. Deleting the Document removes all of them
   (the existing cascade). When a selected area's Document has more than
   one area, its card says how many ("1 of 3 areas of this Document").
8. **Counting.** The Maps list's "N Documents" and the Room import preview
   (`document_count`) count **distinct** Documents, not areas.
9. **Tag filter** (spec 38 Decision 8): dims or keeps all of a Document's
   areas together (no change needed: it reads each area's Document).
10. **Phone**: read-only as today; a tap highlights the Document's areas
    like Decision 6.

## Design

### Backend

- **Migration** (reversible, one revision for 77 and 77b): drop
  `uq_relationship_map_areas_document`; add `relationship_maps.area_labels`
  (Decision 5); add `relationship_map_legend_presets.kind` and move its unique name
  constraint from `(room_id, name)` to `(room_id, kind, name)` (ticket 77b;
  downgrade fails clearly if two presets of different kinds share a name).
  The `document_id` index stays. Downgrade recreates the constraint and
  **fails with a clear message** if a map already has a Document twice as
  an area (it never deletes areas on its own). Applied through the
  `db-migration` label (ticket 74): staging when the PR merges, production
  with the next release PR.
- **Domain** (`geographic_maps.py`): `plan_geo_board_edit` checks pins
  once per Document and areas never twice against a pin (Decisions 1-2),
  with hidden places counted as today; `merge_geo_changes` keeps a new area
  for a Document already on the map as areas and still drops one for a
  Document that is a pin (and the reverse); `geo_document_count` counts
  distinct Documents. `RelationshipMapAreaRow` loses its `UniqueConstraint`.
- **Import** (`map_import.py`): several areas may name the same `document`;
  a Document named by an area **and** a pin, or by two pins, keeps the
  later one as a plain label and the report lists it under "repeated"
  (*as built*: like a name not found, so no file is refused for it; the
  first draft had a `documentTwice` error). The format stays `schema_version` 1 (a
  file with one area per Document still imports the same way). The export
  writes each area with the same `document` and keys `name`, `name-2`, ...
  (already the case).
- **Room export/import/duplication** (`map_transfer.py`, `room_copy.py`):
  no change beyond `document_count` (Decision 8).
- **Tests** (100% on the touched domain): several areas for one Document
  save and come back; area + pin, two pins still refused (save, import,
  live `PATCH`); a hidden area of a Document plus a new visible one by a
  Player; the count of distinct Documents; export → import round trip with
  three areas of one Document; the migration up and down on an empty map.

### Frontend

- `lib/geoMaps.ts`: `placesOfDocument(board, documentId)` (all areas or the
  pin); `pinnedDocumentIds` for the picker (Decisions 2, 4); unit tests.
- `PlaceDocumentSelect`: offer Documents with areas, mark them "(already on
  the map)", hide those with a pin when picking for an area, and those with
  an area or a pin when picking for a pin.
- `GeographicBoard.tsx`: the sibling highlight (Decision 6), drawn from the
  theme (a thinner outline in the area's color, light and dark), the "Add an
  area" button and the "1 of 3" line on the card; `RelationshipMapPage`
  passes the list from `placesOfDocument` for the split pane.
- New strings in all 12 UI languages (spec 34: `en.json` first).
- Demo (spec 45/64): one demo Document gets a second area, so the landing
  tour shows a patchwork territory.

### Color-blind palettes (ticket 78, PR #378)

Ticket 78 lets each user pick a palette (Standard, Protanopia,
Deuteranopia, Tritanopia) with the same 17 color names; `colorValue`
returns `var(--palette-<name>)` instead of a hex. This ticket stays
compatible with it:

- **Only names are stored and sent**: the shared color of a Document's
  areas (Decision 4b), the import/export and the live updates carry the
  color's **name** (`"red"`), never a hex, so a Document's areas are the
  same slot for everyone, whatever palette each viewer uses.
- **Every color drawn goes through `colorValue`**, and transparency is set
  with `fill-opacity` / `stroke-opacity` (as areas do today, 0.22), never by
  appending an alpha to a hex string or computing `rgba()` from it, which
  would break on a CSS variable.
- **Never color alone** (Decision 6): the selected area and its siblings
  differ by **outline width and a halo in the theme's text color**, not by
  hue; the "1 of 3" line and the name tooltip say which Document it is.
- Whichever of the two PRs merges second checks the new code against the
  other (no hex in the area components; the palette's CSS variables in the
  sibling highlight).

### Docs

- Spec 38: Decisions 3, 4 and the import format ("A Document may have
  several areas, or one pin") and the prompt for Claude in another chat.
- `architecture.md` (geographic maps rules), `progress-tracker.md` (Next
  Up, migration pending).

## As built (2026-11-27)

- Binding an existing area to another Document (Decision 4b) is now
  allowed by the save: the old rule "an area keeps its Document" refused
  it although the dialog offered it.
- The demo map's Odaiba has a second area, and the demo's maps list counts
  distinct Documents.

## Answered (product owner, 2026-11-27)

1. **Pin and areas together?** "Solo aree al momento": no (Decision 2).
2. **Name on every area?** "Vorrei che si potesse scegliere": a per-map
   setting, every area or only the largest (Decision 5).
3. **"Add an area" button?** "Entrambi i modi": the button and binding an
   existing area; all areas of a Document share one color, by default the
   first area's (Decisions 4, 4b).

## Effort

About **3.5 hours of Claude's own build time**, one PR into `staging`:
backend, migration and tests about 1 hour 15 minutes; frontend (picker,
shared color, name setting, highlight, card, split pane) about 1 hour 45
minutes; strings in 12 languages, demo and docs
about 30 minutes. Plus a quick check on staging once deployed.

## Definition of Done

- A Document can be bound to several areas of one geographic map, by
  drawing, by "Add an area" and by JSON import; each area can be moved,
  reshaped, linked and deleted on its own.
- Selecting one area, or opening its Document in the split pane,
  highlights all of the Document's areas.
- Pins keep the one-per-Document rule; a Document is never an area and a
  pin on the same map.
- A Document's areas always share one color; names follow the map's
  "every area / largest only" setting.
- Visibility unchanged: a Player never sees any area of a hidden Document
  (save, export, live updates).
- Migration applied to staging through the label; listed as pending for
  production in the tracker.
