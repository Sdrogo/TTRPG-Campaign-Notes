## Goals

- Product owner's request (2026-10-19): "I want duplication and export/import to support Maps too."
- **Duplicate Room** (spec 33) copies the Room's maps: free relationship maps (spec 28), geographic maps (spec 38) and Document mention maps (spec 36), with everything on them. Spec 33 Decision 4 left them out as "a separate ticket if wanted": this is that ticket.
- The **JSON Room export** (spec 23) carries the maps the requester sees, and the **import** (spec 27) recreates them, so a Room moved or restored through a file keeps its maps.
- No migration: every table already exists.

## Decisions (proposed by Claude, confirmed by the product owner 2026-10-19)

### Duplicate Room

1. **Every map is copied**: free maps, geographic maps and the Documents' mention maps, with their groups, cards, arrows (free), areas, pins, links (geographic), the saved depth and moved cards (mention maps), and which map each Document shows on its page (`document_linked_maps`, spec 36 Decision 15). Name, description, colors, positions, labels and plane size stay as they are.
2. **Re-pointed into the copy**: a card, area or pin of a Document points at the copied Document; a card's chosen image at the copied image row; a mention map's center at the copied Document. Nothing in the copy points back at the original Room.
3. **Who and what belongs to people** (as spec 33 Decision 8): the person duplicating is the creator of every copied map, so they manage it; **Selective becomes Private** (the grant list names members of the original Room); Room, Master-only and Private stay. Master-only cards, areas, pins, arrows and links stay Master-only (the duplicator is the Master).
4. **Backgrounds are shared, not re-uploaded** (as spec 33 Decision 10 for images): the copied geographic map names the same Storage object. `storage_cleanup` already keeps an object while any map row references it, so deleting either Room, or replacing either background, leaves the other intact.
5. Same transaction as the rest of the copy, bulk inserts in a fixed number of statements per kind (NFR-04). The confirmation text now says maps are copied.

### Export

6. **JSON only**: the Room export's JSON gets a `maps` list and `schema_version` becomes **3** (the import reads 1 to 3; older files have no maps). Markdown and the Room PDF don't change (JSON is the lossless path, spec 27 Decision 7). A **single-Document export has no maps**.
7. **What is in it is what the map page shows the requester** (Invariant 1, VR-07): the free and geographic maps they see (`is_map_visible`), each board filtered with `visible_board` / `visible_geo_board`, a card's chosen image only when they see it. Mention maps are left out: they are drawn from the mentions every time they are read, so the import has nothing to rebuild them from that the Documents don't already carry. A Tag-filtered export keeps every visible map; cards of Documents left out of the file are dropped by the import (Decision 10).
8. **Shape** of a map: `id`, `name`, `description`, `kind` (`free` / `geographic`), `visibility`, `plane_width`, `plane_height`, `background_url` (a signed link that expires, like images), `linked_document_ids` (the exported Documents that show this map on their page), and the board: `groups`, `cards`, `arrows` for a free map, `areas`, `pins`, `links` for a geographic one, with the fields of the board API (ids, `document_id`, `image_id`, colors, positions, labels, `master_only`). No grant list (never imported, spec 27 Decision 12).

### Import

9. **Maps are always new**: each map of the file becomes a new map of the Room with fresh ids (no Copy / Replace question: a map has no history to keep). The importer is its creator. The preview lists the maps with a tick each, checked by default.
10. **Documents it points at**: a card, area or pin of a Document of the file that is imported (copied or replaced) points at that Document. One whose Document is not imported (not in the file, unticked) is **left out**, and the arrows or links touching it with it. Text cards, groups and plain areas and pins stay. The preview says how many are left out per map.
11. **Visibility** as for Documents (spec 27 Decision 12): the file's level when it is one the app knows, **Selective becomes Private**, none means the Room's default. **Master-only** items are imported only when the importer is the Master; for anyone else they are left out (with their arrows or links) and the preview says so.
12. **Same rules as a board save**: each map goes through `plan_board_edit` / `plan_geo_board_edit` against an empty map (lengths, positions inside the plane, caps, ends on the map). A map that fails them is **skipped whole** and listed with reason `invalid`; it never fails the import. The Room cap of 100 maps holds: maps past it are skipped with reason `limit`.
13. **Written with the Documents**, in the import's one transaction. Then, best effort and like images (spec 27 Decision 15): a geographic map's **background** is read from this app's own Storage when the importer sees that map, else fetched from its link through `remote_images`, validated and stored like an uploaded background (at most 4096 px); one that fails is listed (`background`) and the map stays without it. A card's **chosen image** follows the image it named once the job has attached it; until then, or if it never comes, the card shows the Document's favorite.
14. **Links to Document pages**: a copied Document listed in a map's `linked_document_ids` shows the new map on its page. A replaced Document keeps the map it shows now (Replace touches information only, spec 27 Decision 6).
15. The result lists the maps created (links to them) and the maps or backgrounds skipped with the reason.

## Implementation

- One branch into `staging`, backend and frontend together, **no migration**.
- **Backend**
  - `app/domain/room_copy.py`: the source holds the maps (`SourceMap`); `plan_room_copy` re-ids them (Decisions 1 to 3). `app/db/room_copy_repo.py` reads them in a fixed number of queries and writes them with the copy.
  - `app/domain/map_transfer.py` (pure): the map JSON of the export (`map_to_json`) and, for the import, `read_map` (file → `FileMap`) and `plan_map` (→ `PlannedMap`, Decisions 9 to 12); `room_copy.copy_map` re-ids a map for both duplication and import. `app/db/map_transfer_repo.py` reads a Room's maps and bulk-inserts them.
  - `app/api/export.py::export_maps`: the Room JSON export reads the requester's maps; `app/domain/export.py` bumps `SCHEMA_VERSION` to 3.
  - `app/domain/import_files.py` reads `maps`; `app/domain/imports.py` plans them; `app/api/imports.py` previews them and takes `maps` in the choices; `app/api/import_job.py` writes them and then fetches backgrounds and re-points chosen images (Decisions 13, 14).
  - Tests at 100%.
- **Frontend**
  - The import preview lists the maps with ticks and warnings; the choices send `maps`; the result lists the maps created and skipped; the Room's maps are read again when the job ends.
  - The duplicate confirmation mentions maps. New strings in all 12 locales.
- Update `architecture.md` (Room duplication, export, import) and `progress-tracker.md`.

## Built (2026-10-19)

As above, in one PR into `staging`, no migration.

## Definition of Done

- Duplicating a Room with a free map, a geographic map with a background and a mention map gives a copy whose maps show the copied Documents; deleting the original Room keeps the copy's background.
- A Room's JSON export holds its maps as the requester sees them; a Player's file has no map, card or link hidden from them.
- Importing that file into another Room recreates the maps around the imported Documents, leaves out what points at Documents not imported, and attaches the background.
- Backend `pytest` (100% coverage), `ruff`, `mypy`; frontend `npm run build`, `npm run lint`, `npm test`.
