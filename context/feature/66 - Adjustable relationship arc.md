# 66 - Adjustable relationship arc

## Goals

- Product owner's request (2026-11-09): "Mi piacerebbe avere la possibilità
  di modificare l'arco di una relazione (come adesso succede per le mappe
  geografiche) anche per le Mappe relazionali."
- Spec 62 draws every arrow of the free maps (spec 28) and mention maps
  (spec 36) as an automatic curve (12% bend, fanned 40 px apart). It left out
  (62 Decision 8) a bend per arrow dragged by a handle, as the links of a
  geographic map have (spec 38: `bend`, `bendThrough`, the handle in
  `GeographicBoard.tsx`). This ticket adds it for the **free maps**.
- Needs **one migration** (a nullable `bend` column on
  `relationship_map_arrows`). `requirements.md` is not touched.

## Decisions

*Proposed defaults, to confirm before any code.*

1. **Same meaning as the geographic `bend`**: how far the curve's middle
   leaves the straight line between the two ends' centers, in board pixels,
   positive to the right of the way the arrow goes, negative to the left,
   within +/-5000 (geo's `MAX_BEND`). `null` (the default for every existing
   arrow) keeps spec 62's automatic curve, so nothing already on a map moves.
2. **Handle**: while the editor has an arrow selected (the same click that
   opens it today), a round handle in the arrow's color sits on the middle of
   the curve. Dragging it bends the curve so its middle follows the pointer
   (`bendThrough`, rounded to whole pixels), dropping it saves. Double-click
   (phone: double-tap) the handle gives the arc back to the automatic one
   (`null`). Dragging the handle across the straight line flips the curve to
   the other side; bend 0 is a straight line.
3. **Phone**: the handle is drawn at least 44 px wide to touch, the drag uses
   pointer events (one finger on the handle bends, one finger elsewhere pans
   as today), and the arrow's dialog gets a "Reset arc" button so resetting
   does not depend on a double-tap.
4. **Arrows with their own bend leave the fan**: an arrow with a bend is left
   out of the automatic 40 px fan of its two cards (as geo links with a bend
   are), so the others close up; those still on `null` keep fanning.
5. **Plain lines of a bundle (spec 28 follow-up) bend together**: the lines
   joining the same two cards stay parallel 7 px lanes of one curve. Dragging
   the handle of one line sets the bend (normalized to the bundle's canonical
   side) on **all lines of the bundle**; resetting clears them all.
6. **Labels follow**: labels are already measured along the curve (spec 62
   Decision 5); a label dropped by hand keeps its position and offset, so it
   moves with the new bulge and stays beside its arrow.
7. **Permissions and live updates**: nothing new. The bend is a field of the
   arrow, saved with the board like the label places (the Master, and players
   where the map is editable, spec 42; Master-only arrows stay hidden from
   players). The real-time sync of spec 43/52 sends the whole arrow, so
   other editors and viewers see the new arc without a reload; while one
   person drags, the others get it on drop, as for dragging a card.
8. **Export, import, duplicate**: the JSON export (spec 40) writes `bend`
   on each arrow only when set; import reads it as optional, so files without
   it (older exports, the Obsidian import of spec 65) still work and the
   export format version does not change. Duplicating a Room or a map copies
   it with the arrow (same transfer code). Out-of-range values on import are
   a validation error, as for geo links.
9. **Mention maps** (spec 36), whose arrows come from the mentions and are
   not edited, keep the automatic curve. Geographic maps are unchanged.
10. **Demo**: the demo's maps accept the field (`bend: null`); no demo
    arrow is pre-bent.

## Design

- **Migration** (new revision after the current head): `bend FLOAT NULL` on
  `relationship_map_arrows`, `CHECK (bend IS NULL OR (bend >= -5000 AND bend
  <= 5000))`. Additive and nullable, so old code keeps working while it is
  applied. To apply by hand on staging before merge, on prod before the next
  release to `main` (see "Migrations and Releases").
- **Backend**: `RelationshipMapArrowRow.bend`, `Arrow` (domain) and the API
  models gain `bend: float | None` (finite, +/-5000), through
  `relationship_maps_repo` (read and the whole-board upsert),
  `map_transfer` / `map_transfer_repo` (export, import, Room copy).
- **Frontend**: `Arrow.bend` in `types/map.ts` and the API row in
  `lib/maps.ts` (`bend: number | null`); `arrowFan`/`fanBend` skip arrows
  with a bend and use it as is (Decision 4-5); `bendThrough` moves from
  `lib/geoMaps.ts` to `lib/maps.ts` and is shared (geoMaps re-exports it).
  The handle lives in `MapArrow.tsx` (drawn in the edge-label layer so it
  can be dragged inside React Flow), with the pointer logic of the label drag;
  `ArrowDialog` gets "Reset arc"; strings in all UI languages.
- Docs updated when built: `ui-context.md` (Relationship maps, Arrows),
  `architecture.md` (arrows column, JSON format), progress tracker.

## Tests

- Backend: the bend round-trips through create/update/read; out of range or
  non-finite is rejected; export includes it only when set; import accepts
  files with and without it; Room copy keeps it.
- `lib/maps.ts`: a set bend is used as is; arrows with a bend leave the fan;
  `bendThrough` gives 0 on the straight line and flips sign across it; a
  bundle's lines share the stored bend and keep their lanes.
- `MapArrow` / `MapBoard`: the handle shows only for a selected arrow while
  editing, dragging saves the bend, double-click and "Reset arc" save `null`.
- Frontend CI's 100% branch coverage and `tsc -b` hold; geographic map tests
  stay green.

## Open questions for the product owner

1. Do you want the handle on **players too** where the map is editable, or
   the Master only? (Proposed: same rights as moving a card.)
2. For a bundle of plain lines, is "all bend together" right, or should
   each line be bendable alone (they would then cross)? (Proposed: together.)
3. Should the bend be **reset automatically** when a card is moved far
   away? (Proposed: no; it is a pixel offset, like geo links.)
