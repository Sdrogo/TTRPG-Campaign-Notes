# 36 - Mention map

## Goals

- Product owner's request (2026-10-14): "In a Document we can generate a Map
  with that Document and all the other Documents that are Mentioned or are
  mentioning it. So we create a fully populated Relational Map for that
  Document."
- One click on a Document's page builds a **relationship map** (spec 28)
  already filled in: the Document in the middle, every Document it mentions
  and every Document that mentions it around it, and the mentions drawn as
  relations between the cards.
- It reuses what exists: the mentions index `document_mentions` (spec 20,
  filled on save from descriptions, Notes and Comments) and the maps tables
  and board of spec 28. It adds no new kind of object.
- `requirements.md` has no requirement for maps yet (spec 28); this ticket
  adds none. A `FR-` entry is added only at the product owner's request.

## Decisions (proposed 2026-10-14, confirm in the PR)

1. **A new, ordinary map (a snapshot)**: generating creates a new map in the
   Room, named "Mentions of *Document name*" (≤100, cut with "…"), with
   the creator as its owner, exactly like a map made by hand. From then on
   it is a free board (spec 28 Decision 1): the user moves cards, adds or
   removes relations, renames it. It does **not** follow later mentions on
   its own; generating again makes another map. *Alternative*: a live map
   that re-reads the mentions on every open (more code, and the user's own
   edits would have to be merged with it), or a "Refresh from mentions"
   button on a generated map (a later ticket, 36b, needs a
   `relationship_maps.source_document_id` column).
2. **Who**: whoever may create a map (spec 28 Decision 2: every member,
   unless the Room disables Document creation by Players, D-13). The map
   starts at the Room's default visibility, like any new map; the 100-maps
   cap applies (409).
3. **Which Documents (one step only)**: the Document itself, the Documents
   its description, Notes and Comments mention, and the Documents whose
   description, Notes or Comments mention it. Only Documents of the Room
   that the **creator** sees, and only mentions in places the creator sees
   (the "Mentioned in" rules, spec 20 Decision 5). Tag mentions are left
   out: a Tag is not a card. Mentions of mentions (two steps away) are not
   followed. *Alternative*: a "depth 2" option.
4. **Which relations ("fully populated")**: one relation for every pair of
   cards on the map where one mentions the other, **including pairs that
   don't involve the center** (if Mira and Thorn both appear and Mira
   mentions Thorn, that relation is drawn too). *Alternative*: only the
   relations that touch the center Document, a plain star.
5. **Direction = mention direction**: A mentions B gives an arrow A → B
   (`forward`, from the mentioning card). A and B mentioning each other give
   **one two-way arrow** (`both`), not two. Several mentions between the same
   two Documents (description and two Notes) still make one relation.
6. **Labels**: none by default; the arrows speak for themselves and the user
   writes labels afterwards. *Alternative*: "mentions" on each one (in the
   creator's UI language), which would clutter a big map.
7. **Look**: default color for every card and relation, no groups, no text
   cards. The center Document's card is the only one in a color (gold
   `#C1A470` from the spec 28 palette) so it stands out. Card images and
   captions follow spec 28 Decision 8 (favorite image, subtitle).
8. **Layout (automatic, on the server)**: the center Document in the
   middle, the others on a ring around it, sorted by name, evenly spaced;
   past 16 cards a second, wider ring. Spacing comes from the card size so
   cards never overlap. To read the map at a glance, Documents that only
   mention the center sit on the left half, Documents the center only
   mentions on the right half, and those that go both ways at the top and
   bottom. No layout library (spec 28 chose none). The user moves cards
   freely afterwards.
9. **Hidden mentions never leak (Invariant 1, VR-07)**: a relation is only
   as visible as the place the mention is written in. A relation is drawn as
   a normal relation when at least one mention behind it is in a
   **description**, or in a Note or Comment visible to **every member**
   (`room` level through its whole chain). A relation that rests only on
   Master-only, Private or Selective Notes and Comments is marked **Master
   only** when the creator is a Master, and **left out** when the creator is
   a Player. So a Player who sees both Documents but not the secret Note
   never learns, from an arrow, that one mentions the other. Cards follow
   spec 28 Decision 4 as usual (a Document hidden from a viewer is absent,
   with its arrows).
10. **Limits**: the spec 28 caps hold (150 cards, 400 relations a map). With
    more than 149 related Documents, the ones linked by the most mentions
    are kept (then by name), and the user is told how many were left out
    ("149 Documents added, 12 left out: a map holds 150"). Relations past
    400 are dropped the same way (fewest mentions first). Nothing ever fails silently.
11. **Where**: a **"Mentions map"** icon button in the Document page header,
    next to Export and History, with a tooltip. Hidden when the user can't
    create maps, disabled (with a tooltip "No mentions yet") when the
    Document mentions nothing and nothing mentions it, in a way the user
    sees (the preview route of 36_1 says so). A click asks nothing: it creates the map and opens it full page
    (`RelationshipMapPage`), with a short notice ("Map created from 14
    mentions") and the "left out" count when there is one. The button is
    shown on phones too: the map is created there and can be viewed, only
    edited from a wider screen (spec 28 Decision 13).
12. **Master's "View as"** (spec 22b): the button is hidden, as every write
    is in View As.
13. **Not in scope**: a refresh of a generated map (see Decision 1), depth
    2, Tag cards, a map generated from a Tag or from search results.

## Design

### Backend (36_1)

- **No migration**: a generated map is a plain `relationship_maps` row with
  its cards and arrows.
- `app/domain/mention_maps.py` (pure):
  - `mention_pairs(mentions, center_id, visible_ids, source_is_public)`:
    from the visible mentions, the set of Documents (Decision 3) and one
    pair per two Documents with its direction (`forward`, `both`), its
    mention count and whether any mention behind it is public (Decision 9).
  - `pick_cards(...)`: the cap and the "most mentions first" order
    (Decision 10), the counts of what was left out.
  - `ring_layout(center_id, sides, card_size)`: positions per Decision 8,
    deterministic for a given input (tested on 0, 1, 16, 17 and 149
    neighbors).
  - `generated_map_name(document_name, locale)`.
- `mentions_repo`: one query for the mentions **from** a Document
  (`list_mentions_by_source_document`), next to the existing
  `list_mentions_of_document`, and one for the mentions **among** a set of
  Documents (both ends in the set), each a single query.
- Visibility of the sources reuses `visible_backlinks`' filters (Document,
  Note, Comment through its parent chain) for the creator, plus a check of
  each source's level for "visible to every member" (Decision 9). No new
  visibility rule.
- **Route** `POST /rooms/{id}/documents/{doc_id}/mention-map` (members
  only, 403; 404 when the creator can't see the Document; 403 when they may
  not create maps; 409 at 100 maps): creates the map, its cards and its
  arrows in one transaction through the spec 28 repository (the same
  `save_board` write, under the map's row lock), and answers `201` with
  `map_id`, `documents_added`, `documents_left_out`, `relations_added`,
  `relations_left_out`. Refused in View As like every write.
- When there is nothing to add (no other Document passes Decisions 3 and
  9 for the creator), the `POST` creates nothing and answers **409**
  (`nothing_to_map`), so a stale click never makes a one-card map.
- **Preview** `GET /rooms/{id}/documents/{doc_id}/mention-map` (members
  only; 404 when the viewer can't see the Document; follows `X-View-As`):
  `{documents, relations}`, the counts the `POST` would add for this
  viewer, computed by the same functions with the same filters (one source
  of truth). It is the button's state (Decision 11): the frontend never
  parses mentions itself, since outgoing mentions sit in Notes and lazily
  loaded Comments, and mentions of hidden Documents must not count
  (VR-07). Both routes share one query path, so the preview costs what a
  generation costs minus the writes.
- Tests at 100%: A mentions B and C, D mentions A, B mentions C gives four
  relations (A→B, A→C, D→A, B→C), and A↔B becomes one `both` when B also
  mentions A; a Player's generated map holds no Document they can't see and no
  relation from a hidden Note; a Master's holds it as Master only; a
  mention in a Selective Comment the Player sees is still left out of the
  Player's map; caps and "left out" counts; Tag mentions ignored; a
  Document of another Room never added; the preview's counts equal what the
  `POST` adds, for a Master and a Player; 409 and no map when there is
  nothing to add; the 100-maps cap; View As refused.

### Frontend (36_2)

- `DocumentDetailPage`: the header icon button (Decision 11), a
  `useMentionMapPreview` query (the preview route, refetched after a
  description, Note or Comment is saved) for its state, and a
  `useCreateMentionMap` mutation (a 409 shows "No mentions yet" and
  refreshes the preview); on success the maps list query is
  invalidated and the page navigates to the new map with a notification.
- `RelationshipMapPage`: nothing new; the map is a normal map.
- New strings in `en.json`, `it.json` and the other UI languages (spec 34:
  English text where a translation is missing, as usual for beta
  languages).
- Tests at 100% branch coverage (frontend CI enforces it): the button's
  three states (hidden, disabled, enabled), the navigation, the "left out"
  notice.

## Implementation

- **36_1** backend, then **36_2** frontend, two branches into `staging`
  (or one PR if small enough). No migration, so nothing to apply to the
  staging or production database.
- Update `architecture.md` (Relationship maps: generated from mentions),
  `ui-context.md` (the header button) and `progress-tracker.md`.

## Definition of Done

- On "Mira", whose description mentions Thorn and Aldric and whom the
  Tavern mentions in a Note, the Master clicks "Mentions map": a map
  "Mentions of Mira" opens with Mira in gold in the middle, the Tavern on
  the left with an arrow to Mira, Thorn and Aldric on the right with arrows
  from Mira, and an arrow Thorn → Aldric because Thorn's description
  mentions Aldric. Every card can be moved; reloading keeps the places.
- Aldric's Master-only Note mentioning Mira gives a Master-only arrow
  Aldric → Mira on the Master's map; a Player sees both cards and no arrow
  between them.
- A Player who can't see Thorn generates the map from Mira: Thorn is not on
  it, and nothing hints that it exists.
- Backend `pytest` (100% coverage), `ruff`, `mypy`; frontend
  `npm run build`, `npm run lint`, `npm test`.
