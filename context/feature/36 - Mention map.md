# 36 - Mention map

## Goals

- Product owner's request (2026-10-14): "In a Document we can generate a Map
  with that Document and all the other Documents that are Mentioned or are
  mentioning it. So we create a fully populated Relational Map for that
  Document."
- A Document can get its own **mention map**: a board with the Document in
  the middle, every Document it mentions and every Document that mentions
  it around it (and, on request, the next steps out), and the mentions drawn
  as relations between the cards.
- The map is **live** (product owner, 2026-10-14): once generated it follows
  the mentions, so writing or removing a `#mention` changes it with no other
  action. It is **shown on the Document's page, under the Document's
  images**, drawn as a board.
- It reuses what exists: the mentions index `document_mentions` (spec 20,
  filled on save from descriptions, Notes and Comments) and the maps tables
  and board components of spec 28.
- `requirements.md` has no requirement for maps yet (spec 28); this ticket
  adds none. A `FR-` entry is added only at the product owner's request.

## Decisions

Confirmed by the product owner on 2026-10-14 unless marked *proposed*.

1. **A live map, one per Document**: generating creates a mention map tied
   to the Document. Its Documents and relations are **never stored**: they
   are computed from the mentions every time the map is read, so a new
   mention shows on the next load and a removed one disappears. What is
   stored is only what a person chose: the depth (Decision 2) and the place
   and color of each card someone moved or recolored. A Document has at most
   one mention map (*proposed*; the header button then opens the settings of
   the existing one, Decision 11).
2. **Depth, chosen in the creation modal** (product owner): "how many steps
   to go", **default 0** = only the first level (the Document's direct
   mentions in both directions). Each extra step adds the Documents that
   mention or are mentioned by the previous ring. *Proposed*: up to 3 extra
   steps, changeable later in the same modal by whoever manages the map. A
   step follows mentions in **both** directions, like the first level.
3. **Which Documents**: Documents of the Room only; **no Tags** (product
   owner). The sources are the ones of "Mentioned in" (spec 20 Decision 3):
   descriptions, Notes and Comments. A Document reached at an earlier step
   is never repeated.
4. **Only the ties to the center** (product owner, 2026-10-14, replacing
   "fully populated" after trying it on a real Room, where the cross
   relations drowned the map): a card is drawn with the relation to the
   card that brought it in, so on the first ring only the relations with
   the center Document; on a further step, the one with its parent card.
   Mentions between other Documents are not drawn.
5. **Direction = mention direction** (product owner): A mentions B gives an
   arrow A → B; A and B mentioning each other give **one two-way arrow**.
   Several mentions between the same two Documents make one relation. No
   labels; default color.
6. **Look and layout** (product owner): the center Document's card is gold
   (`#C1A470`, spec 28 palette), the others default. The center sits in the
   middle; the first ring is packed around it as tightly as the cards allow
   (product owner, 2026-10-14: compact, Documents close to each other):
   concentric rings one card apart, each holding as many cards as fit, the
   Documents that only mention it on the left, those it only mentions on
   the right, mutual ones at the top and bottom, sorted by name. Each
   further step is a ring just outside, each card placed near the angle of
   the card that brought it in. Spacing comes from the card size so cards
   never overlap. Card images and captions follow
   spec 28 Decision 8 (favorite image, subtitle).
7. **Hidden mentions never leak (Invariant 1, VR-07)** (product owner): a
   relation is only as visible as the place the mention is written in. For
   each viewer, computed on read:
   - a mention counts only when the viewer sees its source Document and,
     for a Note or Comment, that Note or the Comment through its whole
     chain (the "Mentioned in" filter), and sees its target Document;
   - the steps (Decision 2) only follow relations the viewer sees, so a
     Document reachable only through a hidden mention is not on that
     viewer's map, and no card ever floats there without a visible reason;
   - so the Master sees every relation, and a Player who sees two Documents
     but not the secret Note linking them sees no arrow between them.

   Since the map is computed per viewer, there is no "Master only" flag to
   set: a relation simply exists for whoever sees the mention behind it.
8. **Who sees the map**: whoever sees the Document (*proposed*): the map has
   no visibility level of its own, it is part of the Document's page, and
   Decision 7 filters what is on it. It follows the Master's "View as"
   (spec 22b), read-only there.
9. **Who manages it** (*proposed*): whoever may create maps (spec 28
   Decision 2, D-13) and sees the Document can generate it; its creator and
   the Master change its depth or delete it. Every viewer can pan and zoom;
   whoever manages it can also **move and recolor cards** (saved for
   everyone, spec 28 Decision 9). Adding or removing Documents and relations
   by hand is not possible: they come from the mentions. To edit freely, a
   manager can **"Copy as a free map"**, which saves the current view as an
   ordinary spec 28 map (a snapshot, with the manager's view only, at the
   Room's default visibility).
10. **Limits** (product owner, ok): 150 cards. Past that, the nearest steps
    win, then the Documents with the most mentions, then by name; the board
    says how many were left out ("12 more Documents not shown: a map holds
    150"). The depth limit keeps the computation small.
11. **The modal** (product owner, instead of a one-click button): a
    **"Mentions map"** icon button in the Document page header, next to
    Export and History, opens a modal:
    - **Depth**: a number from 0 to 3, default 0, with a line under it saying
      what the value means ("0: only the Documents linked directly to this
      one").
    - A live count: "14 Documents, 20 relations" for the chosen depth, from
      the preview route (Design), so the user sees what they'll get.
    - **Create** (or **Save** when the map exists), and, for an existing map,
      **Delete map** and **Copy as a free map**.

    The button is hidden for a viewer who can neither create nor manage the
    map. With nothing to show (no mentions the user sees) the modal says
    "No mentions yet" and Create is disabled.
12. **On the Document page** (product owner): the map is drawn **under the
    Document's images**, in the page's side column (above the info panel),
    as a React Flow board as wide as the images and 360 px tall; without
    images, at the top of that column. Pan, zoom, click a card to open its
    Document; a **"Full screen"** button opens the map full page
    (`RelationshipMapPage`), where a manager moves and recolors cards. Below
    `lg`, where the side column stacks under the text, the board takes the
    full width; on phones it is read-only, like spec 28 Decision 13.
    Nothing is shown when the Document has no mention map, or when the map
    has no relation the viewer sees (just the center card would say
    nothing).
13. **Maps list** (*proposed*): mention maps are not in the Room's Maps
    list; they live on their Document's page. The free maps copied from them
    are.
14. **Not in scope**: Tag cards, labels on the generated relations, relations
    drawn by hand on a mention map, a map from a Tag or from search results.
15. **New map or existing map** (product owner, 2026-10-15: "choose whether
    to create a new one or use an existing Map"; then "it must be added to
    the Document"): when the user manages at least one free map of the Room
    (spec 28 Decision 2), the modal (Decision 11) shows a **"Map"** choice:
    "New mentions map" (or "This Document's mentions map" when it exists,
    keeping Save, Delete and Copy) and the free maps they manage, by name.
    Picking a free map turns the button into **"Add to map"**: what the
    mention map would show them at the chosen depth is added to that map
    once (a snapshot, like Copy, Decision 9: it does not follow later
    mentions), and the map is **linked to the Document**: shown on its page
    under the images (and under its own mention map, if any), read-only,
    with a link to the map's page. One linked map per Document: adding to
    another replaces it. Whoever manages the map takes it off the page with
    an unlink button (the map stays); deleting the map or the Document
    removes the link. A viewer who doesn't see the map doesn't see it on
    the page, and its board shows each viewer what they see (spec 28).
    A Document already on the map keeps its card (place, color, arrows);
    the others get new cards laid out as on a mention map (Decision 6),
    around the Document's card when it is already there, else just right of
    everything on the board, vertically centered on it; the center's new
    card is gold. A relation already drawn between the same two cards, in
    either direction and with any label, is not drawn again. The map's caps
    apply (spec 28, 409). With no free map to manage the modal is unchanged.

## Design

### Backend (36_1)

- **Migration** (reversible): `relationship_maps.source_document_id`
  (nullable FK to `documents`, `ON DELETE CASCADE`, **unique**) and
  `relationship_maps.mention_depth` (nullable `smallint`, 0 to 3, CHECK set
  exactly when `source_document_id` is). A row with a source Document is a
  mention map; its `relationship_map_cards` rows hold only the cards someone
  moved or recolored (Document cards only); it has no groups and no arrow
  rows. The spec 28 queries that list maps skip mention maps.
- `app/domain/mention_maps.py` (pure):
  - `mention_graph(center_id, depth, mentions, visible)`: breadth-first, one
    ring per step, over the mentions the viewer sees (Decision 7); returns
    the cards with their step and parent and the relations (Decision 4) with
    their direction (`forward`, `both`), capped per Decision 10 with the
    left-out count.
  - `ring_layout(graph, card_size)`: positions per Decision 6, deterministic
    for a given graph; a stored card position overrides it.
- `mentions_repo.list_mentions_touching(session, document_ids)`: every
  Document-to-Document mention with its source or target in the set, one
  query; called once per step (at most 4 queries). The viewer filter reuses
  `visible_backlinks`' checks (Document, Note, Comment chain), batched as in
  the Documents list. No new visibility rule.
- **Routes** (members only, 403; 404 when the viewer can't see the
  Document; all follow `X-View-As`, writes refused there):
  - `GET /rooms/{id}/documents/{doc_id}/mention-map`: 404 when there is no
    map; else the map (`depth`, `can_manage`) and its board in the spec 28
    `GET /maps/{map_id}` shape (cards with Document name, image, caption,
    color, position; relations), plus `documents_left_out`.
  - `GET /rooms/{id}/documents/{doc_id}/mention-map/preview?depth=n`: the
    counts `{documents, relations}` for this viewer at that depth, from the
    same functions (one source of truth). Drives the modal's count and its
    "No mentions yet".
  - `POST /rooms/{id}/documents/{doc_id}/mention-map` `{depth}`: creates it
    (403 if the user may not create maps; 409 if it exists; 409
    `nothing_to_map` when the preview would be empty). `PATCH` `{depth}` and
    `DELETE` for whoever manages it.
  - `PUT /rooms/{id}/documents/{doc_id}/mention-map/cards`: the cards a
    manager moved or recolored (`document_id`, `x`, `y`, `color`); a
    Document the manager doesn't see on the map is 404; saved cards of
    Documents no longer on the map are kept (they come back in place if the
    mention does).
  - `POST .../mention-map/add-to-map` `{map_id, depth}` (Decision 15):
    adds the graph at `depth` to a free map the caller manages (404 hidden or
    a mention map, 403 not a manager, 409 `nothing_to_map` or a cap) through
    `relationship_maps.add_to_free_map`, which saves the caller's visible
    board plus the new cards and arrows (`mention_maps.add_to_board`, pure)
    through the board save's checks, then links the map to the Document
    (`document_linked_maps`, migration `e8b4d2f6a9c1`: one row per
    Document, `ON DELETE CASCADE` from both sides); returns the map like
    `GET /maps/{map_id}`.
  - `GET /rooms/{id}/documents/{doc_id}/linked-map`: the linked map as the
    viewer sees it (404 when none or hidden from them); `DELETE` unlinks it
    (whoever manages the map, 403 otherwise).
  - `POST .../mention-map/copy`: creates an ordinary spec 28 map from the
    manager's current view (cards, positions, colors, relations as plain
    arrows), through the usual create and `save_board` paths and caps.
- Tests at 100%: depth 0 to 3 on a small graph (A mentions B and C, D
  mentions A, B mentions C gives four relations at depth 0, and A↔B becomes
  one two-way relation when B also mentions A); a new mention appears on the
  next read and a deleted one disappears; a Player sees no Document they
  can't see, no relation from a hidden Note, and no Document reachable only
  through one; the Master sees all; Tag mentions ignored; the cap and the
  left-out count; preview counts equal the map; one map per Document;
  deleting the Document removes the map; View As read-only; the copy is an
  ordinary map holding only what the manager saw.

### Frontend (36_2)

- `components/maps/MentionMapModal.tsx` (Decision 11): depth input, live
  count (`useMentionMapPreview`, debounced on depth), Create / Save / Delete
  / Copy.
- `components/maps/MentionMapPanel.tsx` (Decision 12): the board in the
  Document page's aside, under `DocumentImageGallery`, reusing
  `DocumentCardNode` and `MapArrow` from spec 28 read-only, with "Full
  screen". `useMentionMap` query, invalidated after a description, Note or
  Comment of this Room is saved (so the page's own edits show at once).
- `RelationshipMapPage`: opens a mention map too (route
  `/rooms/:roomId/documents/:docId/mention-map`), with only move and color
  enabled for a manager, and the "left out" notice.
- New strings in `en.json`, `it.json` and the other UI languages (spec 34:
  English text where a translation is missing, as usual for beta
  languages).
- Tests at 100% branch coverage (frontend CI enforces it): modal states
  (create, existing, nothing to map), panel shown or hidden, full screen,
  read-only for non-managers and on phones.

## Implementation

- **36_1** backend and migration, then **36_2** frontend, both built in
  PR #188 into `staging` (2026-10-14). The migration goes to the staging database before the merge
  and to production before the next release to `main`.
- Update `architecture.md` (Relationship maps: mention maps, computed on
  read), `ui-context.md` (the panel under the images, the modal) and
  `progress-tracker.md`.

## Definition of Done

- On "Mira", whose description mentions Thorn and Aldric and whom the
  Tavern mentions in a Note, the Master opens "Mentions map", leaves depth
  0 and creates it: under Mira's image a board shows Mira in gold in the
  middle, the Tavern on the left with an arrow to Mira, Thorn and Aldric on
  the right with arrows from Mira, and no arrow Thorn → Aldric even though
  Thorn's description mentions Aldric (Decision 4).
- The Master writes `#Lyra` in a Mira Note and saves: Lyra appears on the
  board. Removing the mention takes her away. Moving Thorn's card keeps its
  place after a reload.
- With depth 1, the Documents mentioned by or mentioning Thorn, Aldric and
  the Tavern appear on an outer ring.
- Aldric's Master-only Note mentioning Mira gives the Master an arrow Aldric
  → Mira; a Player sees both cards and no arrow between them, and does not
  see a Document reachable only through that Note.
- A Player who can't see Thorn opens Mira: Thorn is not on the board, and
  nothing hints that it exists.
- Backend `pytest` (100% coverage), `ruff`, `mypy`; frontend
  `npm run build`, `npm run lint`, `npm test`.
