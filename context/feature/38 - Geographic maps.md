## Goals

- Product owner's request (2026-10-17): bring maps like the "Shibuya di notte" one, generated in another chat, into the App. That map is a stylized city: **six zones** drawn as colored shapes, **14 places** as points (7 of them with a Document, the others only named), **dashed links** with a label between places, a street/rail/station background, a side panel with the text of the clicked zone or place, and filters by who controls what. Its data is typed by hand in the page, so nothing in it follows the Documents.
- Product owner's choice (2026-10-17, decision card): a **real geographic map** inside the App (zones and places as stored shapes and points, bound to Documents), not just a background picture under ordinary cards.
- Today's maps (spec 28) are free boards: cards, frames and arrows, no background and no shapes. `requirements.md` §1 lists "battle or geographic maps" as out of scope; **this ticket reverses that**, so §1 and a new `FR-` entry must change, **only when the product owner approves this ticket and asks for it** (`requirements.md` is protected).
- It reuses spec 28 (maps tables, visibility, board editing, arrows, split view), spec 36 Decision 15 (a map linked to a Document) and the image storage of spec 01. No new Document or Tag concept.

## Decisions (proposed 2026-10-17, confirm in the PR)

1. **A kind of map, not a new feature**: `relationship_maps.kind` = `free` (today) | `geographic`. A geographic map is created from the same "New map" dialog (a "Free board / Geographic map" choice), appears in the same Maps list, has the same name, description, visibility, creator and managers (spec 28 Decisions 1-3), and can be linked to a Document (spec 36 Decision 15). A map's kind never changes.
2. **The plane**: a geographic map has a flat plane, `width` × `height` in map units (default 2000 × 1400). It may have a **background image** (the street map, a city plan, a hand-drawn fantasy map), uploaded or picked with image search (spec 29), ≤ 20 MB, PNG, JPEG, WebP or GIF (the App's image rules; stored as WebP, at most 4096 px on its longest side), stretched over the whole plane. An SVG is converted to PNG before upload (see the walkthrough). Without one the plane is the board's plain background. No tiles from an outside map service (the App never calls a third-party map server, and a fictional setting has no real tiles).
3. **Areas** (the zones): a closed shape of 3 to 60 points, with a **name** (default the bound Document's name), an optional **subtitle**, a **color** from the spec 28 palette, a **dashed outline** flag ("proposed zone", like Meiji Jingū in the example) and an optional **Document**. Bound to a Document, the area's name and subtitle follow it, a click opens it (split pane when open, spec 37), and a Document appears at most once per map as an area. Without a Document the area is a plain label. An area can be **filled** or **outline only**.
4. **Pins** (the places): a point drawn as a diamond when bound to a Document and as a circle when plain, with a **label side** (left, right, above, below), a color and an optional **Document**, same binding rules as areas. A Document is at most one pin **or** one area on a map, never both. A pin may sit inside an area; it does not belong to it.
5. **Links**: the arrows of spec 28 Decision 5, stored in their own table (direction, label, reverse label, color, Master only, draggable label) between **pins and areas**, drawn as a dashed curve with a bend the editor can drag. Several line-only links between the same two ends are drawn side by side (spec 28 Decision 5).
6. **Visibility (Invariant 1, VR-07)**: exactly spec 28 Decisions 3-4. An area or pin bound to a Document the viewer doesn't see is absent, **with every link touching it**; a Master-only plain pin or area follows the link rule. A hidden Document's name, subtitle and text never reach a Player (not in the response, the search, the split pane or the export). The Master's "View as" (spec 22b) shows it as that Player.
7. **Side panel (the example's right column)**: the split view of spec 37 already shows the clicked Document next to the map; a plain (Document-less) area or pin shows its own short **note** (≤ 500 characters, plain text), for the "zone summary" text of the example. No new panel.
8. **Filter by Tag** (the example's "filter by who controls it"): the map toolbar has a filter that dims every area and pin whose Document lacks the chosen Tag (the Room's Tags, spec 11_3); it is a view setting, not saved. Color is picked by hand per area, not derived from a Tag (*proposed*; deriving it is a later ticket).
9. **Editing**: as spec 28 Decision 9, plus: draw an area by clicking its corners and closing it, drag a corner or the whole area, add a pin by clicking the plane, drag it, resize the plane's background framing by its two numbers in a "Map" dialog (no georeferencing, no latitude/longitude: the plane is flat, positions are plane units). One editor at a time, last save wins (spec 28 Decision 14).
10. **Import from JSON (38_3)**, with the file format and a step-by-step guide for making it with Claude in the section "The import file and how to make it with Claude" below: a geographic map can be **imported from a JSON file** so a map built outside (the other chat) lands in the App: plane size, areas (points, name, color, dashed), pins (x, y, label side) and links, each optionally naming a Document of the Room by **name** (exact, case-insensitive; no match makes a plain label and the import report lists it). A background image is attached separately. The same JSON is what **"Export map"** on a geographic map downloads (maps stay out of the Room export, spec 28 Decision 14). **The export is built from the same visibility filter as the board `GET` and follows `X-View-As`**: a Player's file omits hidden areas, pins, links, names and notes. **Who may import**: whoever may create maps (spec 28 Decision 2); the import creates a new map owned by the importer, never edits an existing one. **Names the importer can't see** are reported exactly like names that don't exist ("not found"), so the report never reveals a hidden Document, and become plain labels. Coordinates of a real place (longitude/latitude) are converted to the plane by the producer; the App only knows plane units.
11. **Limits**: 60 areas, 300 pins and 400 links per map (409 beyond), 100 maps per Room (spec 28); a free map's 150 cards and 30 groups stay as they are.
12. **Phone**: read-only below `sm` (pan, zoom, open a Document), like spec 28 Decision 13.
13. **Not in scope**: tiles from a map service, searching an address, routes or distances, fog of war or a per-player revealed area, layers that can be switched on and off, measuring tools, combat grids, areas inside areas, moving a free map's cards onto a geographic map (or the reverse).

## Design

### Backend (38_1)

- **Migration** (reversible, RLS + deny policy on each new table): `relationship_maps` gets `kind` (`free` default), `plane_width`, `plane_height` (nullable, set for `geographic`), `background_path` (nullable, the stored image); `relationship_map_areas` (`id`, `map_id`, `document_id` nullable, `name` nullable, `subtitle` nullable, `note` nullable, `points` jsonb (list of `[x, y]`), `color`, `dashed`, `filled`, `master_only`; unique `(map_id, document_id)`; `ON DELETE CASCADE` from the map and the Document), `relationship_map_pins` (`id`, `map_id`, `document_id` nullable, `name` nullable, `note` nullable, `x`, `y`, `label_side`, `color`, `master_only`; unique `(map_id, document_id)`; cascade as above). `relationship_map_links` (`id`, `map_id`, from and to each **either** an area **or** a pin, CHECK exactly one of each pair and the two ends differ, `direction`, `label`, `reverse_label`, the label places and offsets of spec 28 Decision 5, nullable `bend`, `color`, `master_only`; `ON DELETE CASCADE` from the map, the areas and the pins). Links are a table of their own, so the free board's arrows and their CHECKs are not touched. A Document is checked against both tables so it is never an area and a pin on the same map.
- `app/domain/relationship_maps.py` (pure): `visible_areas`, `visible_pins` (as `visible_cards`), `visible_arrows` extended to the new ends, `validate_polygon` (3-60 points, inside the plane, no zero area), `plan_board_edit` covering areas and pins (hidden ones kept, Decision 6).
- **Routes**: the spec 28 map routes carry `kind`; the board `GET`/`PUT` of a geographic map (`/maps/{map_id}/geo`) hold `areas`, `pins` and `links`; the free board routes answer 409 for a geographic map and these for a free one (a free map's response is unchanged). `POST /rooms/{id}/maps/{map_id}/background` (multipart, same size/type checks and signed link as Document images) and `DELETE` of it. 38_3 adds `POST /rooms/{id}/maps/import` and `GET /rooms/{id}/maps/{map_id}/export`. All reads follow `X-View-As`.
- Tests at 100%: a Player's response holds no hidden Document's area or pin and no link touching one; a Player's edit keeps hidden areas and pins; forged ids from another Room; polygon and plane validation; caps; deleting a Document removes its area or pin and links; a free map still rejects areas and pins. 38_3: a Player's export and the import report never contain a hidden Document's name or note; who may import.

### Frontend (38_2)

- `pages/RelationshipMapPage.tsx` branches on `kind`; a new `components/maps/GeographicBoard.tsx` reuses the React Flow setup of `MapBoard.tsx` (pan, zoom, selection, split toggle): the background as the lowest layer, **areas as a custom node** (an SVG polygon in the area's bounding box, label at its center), pins as a custom node, links through `MapArrow.tsx` with the new bend. `AreaDialog`, `PinDialog` and a "Map" dialog (plane size, background) next to the existing dialogs.
- Area drawing and corner dragging as a small state machine in `components/maps/areaDraw.ts` (pure, unit-tested).
- Colors, fonts and radius from the theme (`ui-context.md`), light and dark; areas and outlines stay readable on a dark background image. New strings in all UI languages (spec 34 rule: `en.json` first, then the others).
- The Mention map and the free board are untouched.

### Import and export (38_3)

- `app/domain/map_import.py` (pure): parses and validates the JSON (`schema_version` 1), matches Documents by name among those the importer sees, builds a plan; a dry-run report ("3 names not found, kept as plain labels") before the user confirms, like spec 27.

## The import file and how to make it with Claude (38_3)

A note for the product owner (2026-10-17): a map like "Shibuya di notte" is meant to be **made by Claude in another chat and imported**, not drawn by hand; the editor (38_2) is for touching it up afterwards. The file below is what the import reads; a complete example is in [38 - Geographic maps - example.json](38%20-%20Geographic%20maps%20-%20example.json).

### The file (`schema_version` 1)

- **Top level**: `schema_version` (1), `kind` (`"geographic_map"`), `name` (≤ 100), `description` (optional), `plane` (`width`, `height`, 100 to 20,000 each).
- **Coordinates**: plane units, origin at the **top left**, `x` to the right, `y` **down**. Every point must be inside the plane. For a real city, project longitude/latitude yourself (a simple equirectangular projection is enough) and scale so the whole map fits the plane; the background image must be drawn on the **same extent**, edge to edge.
- **`areas`** (≤ 60): `key` (unique in the file), `points` (3 to 60 `[x, y]` pairs in order, a real surface), `color`, `filled` (default true), `dashed` (default false); and either `document` (the exact name of a Document of the Room) **or**, for a plain area (`document` left out or `null`), `name` (≤ 80), optional `subtitle` (≤ 80), optional `note` (≤ 500), optional `master_only`.
- **`pins`** (≤ 300): `key`, `x`, `y`, `label_side` (`left`, `right`, `above`, `below`), `color`; and `document`, or `name` + optional `note` + optional `master_only`, as for an area.
- **`links`** (≤ 400): `from` and `to` (the `key` of an area or a pin, different), `direction` (`forward`, `both` or `none`), `label`, `reverse_label` (only with `both`), `color`, optional `bend` (how far the curve leaves the straight line, in plane units, negative to the other side), optional `master_only`.
- **Colors**: `default`, `red`, `green`, `purple`, `blue`, `gold`, `orange`, `midnight`, `silver`, `champagne`, `rose`, `pink`, `cobalt`, `violet`, `emerald`, `brown`, `lime`.
- **Documents by name**: a `document` is matched to a Document of the Room by exact name, ignoring case. A name that matches no Document the importer sees (or matches only a hidden one) becomes a plain area or pin with that name, and the report says "not found" (Decision 10). A Document may appear once on the map, as an area or a pin.

### Walkthrough

1. **In the App**, open the Room and export it as JSON (spec 27 / 23, "Export"). It holds the exact Document names, so Claude can use them.
2. **In the other chat**, attach that export, say which places and zones the map should show and, if it helps, attach the notes you already have (like `shibuya.md`). Then paste the prompt below.
3. **Claude answers with two things**: the JSON file and a background image drawn on the same plane. Save them as `shibuya.json` and `shibuya.png`. The App takes PNG, JPEG, WebP or GIF, not SVG: if Claude could only give an SVG, open it in the browser at full size and save a screenshot as PNG, or ask Claude to render it to PNG with code. Open the JSON once to check it looks like the example.
4. **In the App**, Maps, **New map**, choose **Geographic map**, then **Import from file** and pick the JSON. The App shows a report before it creates anything: how many areas, pins and links, and the names that matched no Document. Confirm.
5. In the new map's **Map** dialog, upload the background image. The plane is the same size, so zones and places line up.
6. Touch up with the editor (38_2): move a pin, fix a corner, bind a plain place to a Document you create later. Import always makes a **new** map; to change the map in the chat, ask Claude for a new file and import it again, then delete the old map.

### The prompt (paste it in the chat)

```text
I'm attaching the JSON export of my Room (exact Document names) and notes about
[place]. Build a geographic map for my notes app as a JSON file and a
background image.

1. Choose a plane that fits the place (e.g. 2000 x 1400 units, origin top left,
   y down). If it is a real place, project lon/lat onto it and scale to fit.
2. Draw the background (streets, rails, rivers, labels of streets and stations,
   no zones, no pins) as an SVG exactly as large as the plane, edge to edge,
   and, if you can run code, render it to a PNG of the same size.
3. Write the JSON with this shape: schema_version 1, kind "geographic_map",
   name, description, plane {width, height}, areas, pins, links.
   - areas: key, points (3-60 [x, y]), color, filled, dashed, and either
     "document" (exact Document name from the export) or name/subtitle/note.
   - pins: key, x, y, label_side (left|right|above|below), color, and either
     "document" or name/note.
   - links: from, to (keys), direction (forward|both|none), label,
     reverse_label (only with both), color, bend.
   - colors: default, red, green, purple, blue, gold, orange, midnight, silver,
     champagne, rose, pink, cobalt, violet, emerald, brown, lime.
   - limits: 60 areas, 300 pins, 400 links; a Document at most once.
4. Use "document" only when the name exists in the export; otherwise give a
   plain name. Put secrets only in notes marked "master_only": true.
5. Check before answering: every point is inside the plane, every link key
   exists, JSON is valid. Answer with the JSON in one
   code block and the SVG in another (plus the PNG file if you made one).
```

## Implementation

- **38_1** backend and migration, **38_2** frontend (viewer, then editor), **38_3** import/export, each into `staging`, in that order. The migration goes to the staging database before the merge and to production before the next release to `main`.
- On approval: update `requirements.md` (§1 scope and a new `FR-`, only at the product owner's request), `architecture.md` (Storage Model, a Geographic maps entry), `ui-context.md` (the geographic board) and `progress-tracker.md`.
- **Built in 38_1 (2026-10-17), beyond the text above**: links are a table of their own (`relationship_map_links`), so the free board is untouched; a pin's marker (diamond or circle) is not stored, it follows from whether it has a Document; linking a geographic map to a Document (Decision 1) answers 409 until 38_2 can show it on the Document page; a plane change that would leave an area or pin outside the plane is refused (422).
- **Built in 38_2 (2026-10-17), beyond the text above**: the board is an SVG of its own (`GeographicBoard.tsx`), not React Flow, since areas are polygons in plane units and links are curves between them; `MapArrow` is not reused, `ArrowDialog` is. Area drawing is in `lib/areaDraw.ts` and the geometry in `lib/geoMaps.ts`. A link meets an area on its outline and stops short of a pin. A clicked place shows a small card (its Document link, or its note) when the split pane is closed. The background takes an upload or a URL; image search (spec 29) is not wired to it yet. Linking a geographic map to a Document works since 38_2 (the 409 is gone).
- **Open for the product owner**: whether 38_3 (import) is wanted at once or later; whether a Tag should pick an area's color; the Shibuya map as the first real test, rebuilt from its data once 38_2 is in.

## Definition of Done

- The Master creates a geographic map "Shibuya di notte", uploads a street-map image, draws the six zones with names and colors (Meiji Jingū and Yoyogi dashed), binds "Dōgenzaka" to its Document, puts pins for the 14 places, 7 of them bound to Documents, and draws the four labeled links. Reloading keeps every shape, place and link; clicking a bound area or pin opens its Document in the split pane; clicking a plain one shows its note.
- A Player who can't see the Elysium's Document sees the map without that pin and without the link "la finestra della corte" to it; the Master's "View as" shows the same.
- The Tag filter dims the areas and pins whose Documents lack the Tag; clearing it restores them.
- 38_3: importing the Shibuya JSON creates the same map, reports the names that matched no Document, and exporting it again gives back an equivalent file. A Player's export holds nothing of a Document they can't see, and importing a name that matches only a hidden Document is reported as "not found", like an unknown name.
- On a phone the map opens read-only. A free map still behaves as before.
- Backend `pytest` (100% coverage), `ruff`, `mypy`; frontend `npm run build`, `npm run lint`, `npm test`.
