# 62 - Curved relationship lines

## Goals

- Product owner's request (2026-11-03): "Nelle mappe relazionali tracciamo
  delle linee rette per le relazioni, ma credo che otterremmo un migliore
  risultato con una certa curvatura, come facciamo per quelle della mappa
  geografica."
- The arrows of the free maps (spec 28) and of the mention maps (spec 36),
  today straight lines edge to edge (`MapArrow.tsx`), are drawn as the
  gentle curves the links of a geographic map already use (spec 38,
  `lib/geoMaps.ts`: `linkCurve`, `pointOnCurve`, `curvePath`,
  `DEFAULT_BEND_RATIO`), so a dense map reads better and several relations
  between the same two cards no longer sit on top of each other.
- Frontend only: **no migration**, no API change. `requirements.md` has no
  requirement for maps; this ticket adds none.

## Decisions

Defaults picked on 2026-11-03, to confirm in the PR.

1. **Same curve as the geographic map**: a quadratic curve whose middle sits
   12% of the arrow's length to the side of the straight line
   (`DEFAULT_BEND_RATIO`), to the right of the way the arrow goes. The curve
   helpers move from `lib/geoMaps.ts` to `lib/maps.ts` (geoMaps keeps using
   them), so both boards share one implementation.
2. **Several relations between the same two cards fan out**: one-way and
   two-way arrows joining the same two cards or groups (in either
   direction) each take their own curve, 40 px apart (`PARALLEL_BEND`), in
   the order they were added, as on the geographic map (spec 38 Decision 5).
   Today they overlap exactly and only the top one can be clicked. Since
   the side is relative to the arrow's own way, A → B and B → A already
   bend to opposite sides.
3. **Plain lines keep their metro look**: the plain lines (direction
   `none`) of a bundle (the follow-up of spec 28, `parallelShift`) all share
   one curve, each moved 7 px to its side as today, so they stay parallel
   lanes of one curved bundle. The bundle takes one slot of the fan of
   Decision 2, its curve bent the same way whichever end each line was
   drawn from.
4. **Ends follow the curve**: an arrow leaves and enters a card or group on
   its edge toward the curve's control point (as a geographic link meets an
   area), not toward the other card's center, so the arrowheads point the
   way the curve arrives. Arrowheads stay the React Flow markers, which
   follow the curve's tangent.
5. **Labels ride the curve**: a label's place (position 0-1 and offset to
   the side, spec 28 Decision 5) is measured along the curve, the offset
   still across the straight line, as the geographic map's labels do. The
   automatic placement slides along the curve to avoid the cards and the
   other labels, as it slides along the line today. Dragging a label finds
   the nearest point of the curve. Labels already dropped by hand keep their
   stored values, so they move with the curve's bulge at their spot (at most
   12% of the arrow's length at the middle, less toward the ends), still
   beside their arrow.
6. **Clicking**: the hit area (16 px wide) follows the curved path, so an
   arrow is clicked on its curve; nothing else about editing changes. While
   connecting, the line being dragged stays straight.
7. **Every board that draws `MapArrow`**: the free map page, the read-only
   map linked on a Document page, the Demo's maps) and the mention maps,
   full screen and on the Document page. Geographic maps are unchanged.
8. **Not in scope (*proposed* for a later ticket)**: a bend per arrow
   dragged by a handle, as geographic links have. It needs a `bend` column
   on the free maps' arrows (a migration) and a place in the JSON
   export/import (spec 40); say if you want it.

## Design

- `lib/maps.ts`: `Curve`, `linkCurve`, `pointOnCurve`, `curvePath` moved
  here from `lib/geoMaps.ts` (re-exported or imported there, no behavior
  change); new `arrowBend(arrows, arrow, length)` (Decisions 1-3: default
  bend, fan slot, the plain bundle as one slot with a canonical side);
  `curveEnds(source, target, bend)` (Decision 4: the curve between the
  centers, each end clipped to its box along the way to the control point);
  `projectOnCurve(curve, p)` (nearest t, sampled then refined);
  `placeLabel` takes the curve and slides along it (Decision 5).
- `MapBoard.tsx`: each edge's data carries the arrow's bend (with the
  existing `shift` for plain lanes), computed from the whole map.
- `MapArrow.tsx`: draws `curvePath` of the (shifted) curve, places labels
  with the geographic map's `labelAt` rule (moved to `lib/maps.ts`), and
  drags them with `projectOnCurve`.
- `GeographicBoard.tsx`, `lib/geoMaps.ts`: import the moved helpers; links
  keep their own `linkBend`.
- `context/ui-context.md` (Relationship maps → Arrows) and
  `context/architecture.md` updated when built.

## Tests

- `lib/maps.ts`: default bend is 12% of the length to the right; two
  one-way arrows A → B get two different bends; A → B and B → A bend to
  opposite sides; plain lines of a bundle share one bend and keep their
  7 px lanes; the bundle takes one slot next to a one-way arrow; curve ends
  sit on the boxes' edges toward the control point; `projectOnCurve` finds
  the middle of the curve and clamps past the ends; label placement on a
  curve avoids a card.
- `MapArrow`: the path is a `Q` curve; a dropped label is saved with the
  curve's position.
- Geographic map tests stay green unchanged.
- Frontend CI's 100% branch coverage and `tsc -b` hold.
