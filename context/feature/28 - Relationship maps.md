## Goals

- Product owner's request (2026-10-08): "relationship maps between Documents". A **map** is a free board ("Nobles of Waterdeep", "Who killed the baron?") where a member places Documents as cards and draws labeled arrows between them, like a detective's corkboard.
- **Arrows belong to their map** (product owner's choice, 2026-10-08, "free boards"): an arrow says nothing outside the board it is drawn on. The same two Documents can be linked differently on two maps, and nothing appears on the Document's page. There are no Room-wide relationships.
- **Reference** (product owner's example, 2026-10-08, a Vampire coterie "in Los Angeles"): portraits with a name and a role line under them ("Ancilla Toreador"), arrows with a label on each direction ("Reliable" one way, "Brother in the Cause" the other), boxes grouping several portraits ("Other Faces", "Adversaries and Enemies") that an arrow points to as a whole, plain colored names without a picture (contacts in green, enemies in red, adversaries in purple), a struck-through name for someone gone, and a large title in the middle.
- **Document subtitle** (product owner, 2026-10-08, added to this feature): a Document gets an optional subtitle under its name ("Hoshino Mirai" / "La Idol"). It is its own small unit, **28_0**, built first; a map card shows it as its default caption (Decision 8).
- Today Documents are linked only by `#Name` mentions (spec 20, FR-D4); a map does not change them.
- Not a battle or geographic map: `requirements.md` §1 still leaves those out of scope. **`requirements.md` has no requirement for this yet**: when the product owner approves the ticket, a new `FR-` entry (and a `VR-` for the visibility rule below) is added to it, at the product owner's request only.

## Decisions (proposed 2026-10-08, confirm in the PR)

### Document subtitle (28_0)

- **S1. Field**: `documents.subtitle`, optional plain text, ≤120 characters, one line (no mentions, no Markdown). Set in the create dialog and in the Document's edit fields, by whoever may edit the Document's name (Owners and the Master, D-12). It follows the Document's visibility: it is part of the Document, nothing of its own.
- **S2. Documents list (`RoomDocumentsPage`, `DocumentCard`)**: the subtitle sits right under the name and takes the name's **current** look (`fz="h4"`, `--font-display`); the name moves **one level up** (`fz="h3"`). The heading's `order` stays as it is (2 or 3, for the outline); only the size changes. Without a subtitle the name still uses the larger size, so every card's name looks the same.
- **S3. Document page**: the subtitle sits under the page title, one typography level below it, dimmed; the same rule wherever a Document's name is a page heading.
- **S4. Elsewhere**: the subtitle is in the Room export (JSON field `subtitle`, Markdown line under the heading; `schema_version` 2, the import reads 1 and 2) and the import (27_2) copies it; the Room PDF and the single-Document PDF (23b, 27b) print it under the Document's name; full-text search (spec 21) matches it, weighted like the name; the version history (24b) records it with the name. The mention popup shows it after the name to tell same-named Documents apart.
- **S5. Not**: no subtitle on Tags, Notes or Rooms.

### Relationship maps (28_1, 28_2)

1. **Maps per Room**: a Room has any number of maps, each with a name (≤100) and an optional description. A **Maps** entry in the Room's menu opens the list (cards with name, description, number of Documents, last edit); each map opens full page.
2. **Who**: every member creates a map (a Player too, unless the Room disables Document creation by Players, D-13); its creator and the Master edit, rename and delete it. Others only look at it.
3. **Visibility of a map**: the Comment levels with its creator as the "Owner" (Room default, Master only, Private, Selective), through `is_content_visible`. A level or grant change writes a `map_visibility_changed` AuditLog row (Invariant 7). A map hidden from a member is absent from the list and 404 when asked.
4. **What a viewer sees on a map** (Invariant 1, VR-07): only the Document cards of Documents they see. A hidden Document is simply absent, **with every arrow touching it**: no empty box, no count, no label. So the Master and a Player can see the same map differently, and the Master's "View as" (spec 22b) shows it as that Player.
5. **Arrows**: an arrow links two cards (or groups, Decision 7) of the map, with a **direction**: one way (arrow head), both ways, or none (a plain line). A one-way arrow has one optional **label** (≤60, e.g. "Suspicious"); a two-way arrow has **one label per direction** ("Reliable" / "Brother in the Cause"), each drawn near the end it points to; a plain line has one label in the middle. Labels use the card colors (Decision 8). An arrow can be marked **Master only**: then only Masters see it, even when both cards are visible (a secret "father of" between two public NPCs). The label field suggests the labels already used in the Room, taken **only from arrows the viewer sees** (`visible_arrows`, on maps they see, `X-View-As` included): a label used only on a Master-only arrow or on an arrow touching a hidden Document is never suggested (Invariant 1).
6. **Text cards**: besides Documents, a board can hold **text cards** (≤300 characters, several lines: "Unknown Sire", "Eliza Costa, Personal Assistant / Anthony Jones, Bodyguard"), in three sizes (normal, large, title, for a heading like "New Ideas"). Arrows can link them too. They are seen by everyone who sees the map; a Master-only text card follows the arrow rule. They never become Documents.
7. **Groups**: a **group** is a framed box with an optional title ("Adversaries and Enemies") holding several cards; dragging the group moves them, an arrow can point to the group as a whole. A card belongs to at most one group; groups don't nest. A group shows to everyone who sees the map, with only the cards the viewer sees inside; a group whose cards are all hidden from the viewer, and has no title, is not drawn.
8. **Card look**: a Document card shows the Document's first visible image (portrait framing) and its name, plus a **caption**: the Document's **subtitle** (S1) by default, or a caption written on the map that replaces it on that map only (≤80, "Neonate Ministry / Former Baron of Beverly Hills", two lines), never stored on the Document. Without an image, it is name and caption only, like the plain colored names of the example. Every card, label and group title takes one of a few **theme colors** (default, red, green, purple, blue, gold; no free color picker) and can be **struck through** (someone dead or gone). Click opens the Document.
9. **The board**: pan, zoom, drag a card (positions saved for everyone), draw an arrow by dragging from one card to another, click an arrow to edit or delete it, select several cards to move them or put them in a group.
10. **Adding Documents**: a picker (search by name, filter by Tag; Documents already on the map greyed out). A Document appears at most once per map. Deleting a Document removes its card and its arrows from every map (`ON DELETE CASCADE`).
11. **Limits**: 150 cards, 30 groups and 400 arrows per map (409 beyond), counted over all of them, hidden ones included; 100 maps per Room.
12. **Editing what you can't see**: an editor who doesn't see some cards (a Player's own map after a Document was hidden from them) never sees, moves or deletes them; their edits leave hidden cards and arrows as they are (the rule of `plan_note_order`).
13. **Phone**: below `sm` a map is read-only (pan, zoom, open a Document); editing needs a wider screen.
14. **Not in scope**: maps are not in the Room export, the import or the Room PDF (spec 23, 27, 23b), nor in the version history (24b). One concurrent editor at a time is assumed; the last save wins, no live collaboration.

## Design

### Document subtitle (28_0, backend and frontend)

- **Migration**: `documents.subtitle` (nullable `varchar(120)`); the generated `search_vector` on `documents` is redefined to add the subtitle at weight `A`, like the name (drop and re-add the generated column and its GIN index). Reversible.
- Backend: `subtitle` in the Document create, update and read schemas (trimmed, empty becomes null, ≤120, 422 beyond), in the Documents list response, in the version history snapshot, in `app/domain/export.py` (JSON and Markdown, `schema_version` 2) and the import reader, and in the PDF templates under the name.
- Frontend: a subtitle field in `CreateDocumentModal` and `DocumentFields`; `DocumentCard` per S2; the Document page header per S3; the mention popup per S4. New strings in `en.json` and `it.json`.
- Two branches into `staging` as usual (backend with the migration, then frontend). Tests at 100%: the field's limits; a hidden Document's subtitle never in a list, search result or export; search finds a Document by its subtitle; export, import and history round-trip it.

### Backend (28_1)

- **Migration**: `relationship_maps` (`id`, `room_id`, `name`, `description`, `visibility`, `created_by`, `created_at`, `updated_at`; `ON DELETE CASCADE` from the Room), `relationship_map_grants` (Selective), `relationship_map_groups` (`id`, `map_id`, `title` nullable, `color`, `struck`, `x`, `y`, `width`, `height`; `ON DELETE CASCADE` from the map), `relationship_map_cards` (`id`, `map_id`, `group_id` nullable (`ON DELETE SET NULL`), `document_id` nullable, `text` nullable, CHECK exactly one set, `caption` nullable, `size` = `normal` | `large` | `title` (text cards), `master_only` (text cards), `color`, `struck`, `x`, `y`; unique `(map_id, document_id)`; `ON DELETE CASCADE` from the map and the Document), `relationship_map_arrows` (`id`, `map_id`, from and to each **either** a card **or** a group (`from_card_id`/`from_group_id`, `to_card_id`/`to_group_id`, CHECK exactly one of each pair, CHECK the two ends differ), `direction` = `forward` | `both` | `none`, `label` and `reverse_label` nullable (the reverse only with `both`), `color`, `master_only`; `ON DELETE CASCADE` from the map, the cards and the groups). RLS + deny policy on all five. Reversible.
- `app/domain/relationship_maps.py` (pure): `can_create_map`, `can_manage_map`, `visible_cards` (a Document card only when its Document is visible; a Master-only text card only for Masters), `visible_groups` (Decision 7), `visible_arrows` (both ends visible, a group end counting as visible when the group is drawn, and, when `master_only`, the viewer is a Master), label normalization, `plan_board_edit` (applies an edit to the visible part only, Decision 12).
- **Routes** in `app/api/relationship_maps.py` (members only, 403; 404 for a hidden map; visibility before permission):
  - `GET /rooms/{id}/maps`, `POST /rooms/{id}/maps`.
  - `GET /rooms/{id}/maps/labels`: labels of the arrows the viewer sees (`visible_arrows` on visible maps, never a hidden or Master-only arrow), most used first. Registered before the `{map_id}` routes.
  - `GET /rooms/{id}/maps/{map_id}`: the map, its visible groups, cards (Document name, first visible image and Main Tag read in a fixed number of queries, the Documents-list batch functions) and visible arrows; `can_edit`, and `selective_user_ids` only for those who can manage it.
  - `PATCH` / `DELETE /rooms/{id}/maps/{map_id}` (name, description, visibility).
  - `PUT /rooms/{id}/maps/{map_id}/board`: the editor's whole visible board (groups, cards with positions, arrows); creates, moves, updates and removes in one transaction under the map's row lock, caps checked. A card for a Document of another Room or one the editor can't see is 404.
- All reads follow `X-View-As` (spec 22b).
- Tests at 100%: a Player's response holds no hidden Document, no arrow touching one and no Master-only arrow or text card; a Player's edit keeps the cards hidden from them; label suggestions never include a label used only on a Master-only arrow or on an arrow touching a hidden Document; forged ids from another Room; caps; deleting a Document removes its cards and arrows; AuditLog on a level change.

### Frontend (28_2)

- **New dependency**: `@xyflow/react` (React Flow, MIT): pan, zoom, drag, custom cards and arrows, keyboard navigation. No layout library: new cards go at the center of the view.
- `pages/RoomMapsPage.tsx` (list, create dialog), `pages/RelationshipMapPage.tsx` (board, save debounced after each change, "Saved" indicator), `components/maps/DocumentCardNode.tsx`, `TextCardNode.tsx`, `GroupNode.tsx` (a React Flow parent node), `MapArrow.tsx` (two labels on a two-way arrow), `ArrowDialog.tsx`, `AddDocumentsPanel.tsx`.
- Colors, fonts and radius from the theme (`ui-context.md`), light and dark.
- New strings in `en.json` and `it.json`.

## Implementation

- **28_0** (subtitle) first, then **28_1** backend and migration, then **28_2** frontend, into `staging`. The migration goes to the staging database before the merge and to production before the next release to `main`.
- Update `architecture.md` (Storage Model, a Relationship maps entry), `ui-context.md` (the board) and `progress-tracker.md`.

## Definition of Done

- "Hoshino Mirai" gets the subtitle "La Idol": on the Documents list the subtitle has the name's old size and the name is one level larger; the Document page, the export, the PDF and search show it; a Player who can't see the Document finds none of it.

- The Master rebuilds the product owner's example: portraits with captions, two-way arrows with a label per direction, a group "Adversaries and Enemies" an arrow points to, colored text cards, a struck-through name, a title. Reloading keeps every place, group and arrow.
- On a smaller map: the Master adds Aldric, Mira and Thorn and a text card "the night of the fire", draws "Mira ↔ Thorn: ally of / ally of" and "Aldric → Mira: father of" (Master only).
- A Player opening the map sees the three Documents, the text card and the alliance only; a Player who can't see Thorn sees Aldric, Mira and the text card, and no arrow.
- That Player's own map holding Thorn, after Thorn is hidden from them, keeps Thorn's card when they move the others; the Master still sees it.
- Backend `pytest` (100% coverage), `ruff`, `mypy`; frontend `npm run build`, `npm run lint`, `npm test`.
