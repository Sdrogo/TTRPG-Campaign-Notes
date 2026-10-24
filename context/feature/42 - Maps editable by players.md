# 42 - Maps editable by players

## Goals

- Product owner's request (2026-10-24): "Vorrei che si possa sbloccare una
  mappa per essere modificata dai giocatori." Today only a map's creator and
  the Master edit it (spec 28 Decision 2); everyone else only looks.
- A map can be **unlocked**: then every member who sees it edits what is on
  it, not only its creator and the Master. A table can build the coterie
  board or the city map together.
- Applies to free maps (spec 28) and geographic maps (spec 38). Not to
  mention maps (spec 36): they are drawn from the mentions, so there is
  nothing to edit but card places, which stay with their managers.
- With more than one editor, spec 28 Decision 14 ("one concurrent editor
  at a time, the last save wins") no longer holds: a save sends the whole
  board, so one editor's save would silently delete what another added in
  the meantime. This ticket adds a **guard** so that never happens
  (Decision 7). Real merging of concurrent edits and seeing others' edits
  live are a separate, heavier piece of work (the "Real-time editing"
  analysis, 2026-10-24), not part of this ticket: on 2026-10-24 the
  product owner chose the guard only here, and per-item saves (only the
  changed items sent) as their own spec 43, which replaces this whole-board
  save and its 412 while keeping `revision` as the version number.
- `requirements.md` has no requirement for maps (spec 28, 36, 38); this
  ticket adds none.

## Decisions (defaults picked 2026-10-24, to confirm in the PR)

1. **A switch per map, locked by default**: `relationship_maps.players_can_edit`,
   `false` for every new map and every existing one. In the map's settings
   (the dialog that already holds name, description and visibility):
   "Players can edit the map" ("I giocatori possono modificare la mappa").
   A free map and a geographic map have it; a mention map does not (it has
   no settings dialog, the map routes answer 404 for it, and `can_edit_map`
   ignores the flag on one).
2. **Who flips it**: whoever manages the map today (its creator and the
   Master, spec 28 Decision 2), like the rest of its settings. So a Player
   who made a map can open it to the others too. Not while previewing as a
   member (spec 22b refuses writes).
3. **Who edits an unlocked map**: every member of the Room who **sees** the
   map. Visibility already narrows it: a Selective map unlocked is edited by
   the members it is shared with, so there is no separate list of editors.
   A Master-only map stays the Master's.
4. **What they edit**: the board, the same way its managers do: on a free
   map cards (Documents and text), groups and relations: add, move,
   restyle, remove; on a geographic map areas, pins and links. Everything
   they see on it, whoever put it there: items have no author, so there is
   no "only your own" rule (the Master locks the map again if a table needs
   it). Everything spec 28 Decision 12 and spec 38 already guarantee still
   holds: an editor never sees, moves or deletes what is hidden from them;
   only a Master makes Master-only content (403); a Document card or place
   only for a Document they see (404); the caps count every item (409).
5. **What stays with the managers**: renaming, the description, the
   visibility and Selective list, this switch, deleting the map, a
   geographic map's plane size and background image (upload, from a link,
   removal), linking the map to a Document's page (spec 36 Decision 15) and
   the mention map's own controls. The ⋮ menu shows a non-manager editor no
   Settings, Delete or "Map" (plane) entry.
6. **Phone and View As**: unchanged. Below `sm` a map is read-only for
   everyone (spec 28 Decision 13); "View as" is read-only (spec 22b).
7. **Guard against overwriting others** (spec 28 Decision 14 superseded):
   every map gets a `revision` number, raised by every write to the map
   (board save, settings, background). A board save carries the revision
   the editor's board was loaded at (`base_revision`); if the map has moved
   on since, the save is refused with **412** and nothing is written. The
   page then reloads the map as it is now and says so: "Someone else changed
   the map: it was reloaded and your last change wasn't saved. Do it again."
   ("Qualcun altro ha modificato la mappa: l'ho ricaricata e la tua ultima
   modifica non è stata salvata. Rifalla.") What is lost is at most the
   change since the last save (the board saves 800 ms after the last
   change). A save without `base_revision` is not checked (an old tab
   during a release); the current frontend always sends it. This holds on
   locked maps too (the creator and the Master in two tabs).
8. **No audit, no history**: flipping the switch changes no visibility, so
   it writes no AuditLog row (Invariant 7 is about visibility), and maps
   have no version history (spec 28 Decision 14).
9. **Copies start locked**: a duplicated Room (spec 33), an imported Room
   (spec 40) and an imported geographic map file (38_3) make maps with the
   switch off; the exports don't carry it. The new owner decides again.
10. **Not in scope**: merging concurrent edits, showing others' edits live,
    presence ("Marco is editing"), per-item authorship, a list of editors
    per map, letting Players edit mention maps.

## Design

### Backend (42_1)

- **Migration** `e2b7c4f9a1d6`: `relationship_maps.players_can_edit BOOLEAN
  NOT NULL DEFAULT false` and `relationship_maps.revision INTEGER NOT NULL
  DEFAULT 0`. Reversible. Applied to the staging and production databases
  2026-10-24.
- `RelationshipMap.players_can_edit` and `.revision` (domain), mapped by
  `relationship_maps_repo`; `update_map` writes the flag and raises the
  revision by one (under the map's row lock, taken by `get_managed_map` /
  `get_editable_map`).
- `app/domain/relationship_maps.py`: `can_edit_map(map, user_id, role)` =
  `can_manage_map` or (`players_can_edit` and not a mention map).
  `ensure_base_revision(map, base_revision)` raises `StaleBoardError`
  (412, `errors.map.changedByOthers`) when given and different.
  `update_map` returns the map with its new revision, so every response
  carries it.
- `app/api/relationship_maps.py`: `get_editable_map` (like `get_managed_map`:
  404 for a hidden map, 403 `errors.map.notEditor`, then the row lock).
  `PUT /board` and `PUT /geo` go through it and check `base_revision`
  (optional field of `BoardRequest` and `GeoRequest`). Everything else keeps
  `get_managed_map`. `PATCH` takes `players_can_edit`.
- Responses: `MapResponse` gets `players_can_edit`, `revision` and
  `can_manage`; `can_edit` now means "may change the board" (`can_edit_map`).
  `selective_user_ids` still goes only to managers. The Maps list's `can_edit`
  follows the same rule, so the mention map modal's "copy into a free map"
  picker lists only maps the user manages (`can_manage`).
- Room duplication, Room import and the map file import write `false`
  (Decision 9): they build maps through `insert_map`, whose default is off.

### Frontend (42_2)

- `RelationshipMap.playersCanEdit`, `.revision`, `.canManage`.
- `MapFormModal`: a `Switch` under the visibility, only when editing an
  existing free or geographic map's settings; sent by `useUpdateMap`.
- `RelationshipMapPage`: the board is editable on `canEdit`; Settings,
  Delete and the plane dialog on `canManage`. A small "Players can edit"
  badge next to the visibility badge while unlocked, for everyone who sees
  the map.
- Autosave sends `baseRevision`, the revision of the board it started from,
  then of each saved response. On 412 it refetches the map, remounts the
  board from it and shows the notice of Decision 7.
- Mention map modal: the copy target list filters on `canManage`.
- Strings in all 12 languages.
- Built 2026-10-24 with two refinements: saves go one at a time (a change
  made while a save is in flight waits for its answer, so it never carries
  a stale revision), and the page takes the stored board, without
  remounting, whenever the stored revision moves past its own while nothing
  is pending (after a 412 reload, a settings or a background change).
  Settings changes also refresh a geographic map's `.../geo` read, where
  its page reads the revision.

## Tests

- Backend (100% coverage): a Player who sees an unlocked map saves its board
  and its geographic board; locked, 403; a Player still gets 403 on rename,
  visibility, the switch, delete, plane, background and linking; a hidden
  unlocked map is 404; a Player's save keeps the Master-only and hidden
  items and can't add Master-only content; a mention map's flag edits
  nothing for a Player; a stale `base_revision` is 412 and writes nothing; every write
  raises the revision; duplicated and imported maps start locked.
- Frontend: the switch round-trips; a Player sees an unlocked map editable
  but no Settings or Delete; 412 reloads the board and shows the notice.

## Definition of Done

- The Master opens "Coterie di Los Angeles" settings, turns on "Players can
  edit the map", saves. Giulia (Player) opens it on a laptop, adds Thorn's
  card and a relation "rivale" and moves Mira; reload keeps them. Giulia
  can't rename or delete the map. The Master's Master-only relation is
  still there, unseen by Giulia.
- With Giulia and Marco both on the page, Marco moves a card after Giulia's
  last save: his save goes through; Giulia's next change is refused, her
  page reloads with Marco's move and tells her to redo her change. Nobody's
  saved work is lost.
- The Master locks the map again: Giulia's page is read-only after a reload.
- Backend `pytest` (100% coverage), `ruff`, `mypy`; frontend `npm run build`,
  `npm run lint`, `npm test`.
