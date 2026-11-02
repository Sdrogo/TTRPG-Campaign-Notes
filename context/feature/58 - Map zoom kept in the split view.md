# 58 - Map zoom kept in the split view

## Goals

- Product owner's report (2026-11-02): "nelle mappe geografiche, se faccio
  zoom e poi apro la preview di uno dei documenti (nella split screen) la
  mappa torna allo zoom iniziale. è fastidioso, vorrei che mantenga lo zoom
  attuale".
- Opening or closing the split pane (spec 37, 37b, 38b, 50) beside a map
  keeps the map's zoom and the point at the middle of the board.
- Frontend only, no migration.

## Cause

`PageLayout` rendered the page body on its own while the pane was closed
and inside `SplitView` while it was open. The two trees differ, so React
unmounted and remounted the whole page on every open and close, and the
map's view (kept in `GeographicBoard` state) went back to "whole plane".
The same remount also reset free relationship maps and mention maps, and
any unsaved state of other Room pages.

## Decisions

1. **The page stays mounted.** On a Room page `PageLayout` always renders
   `SplitView`; with nothing beside, `SplitView` shows its left pane at full
   width with no divider. The page element is the same either way.
2. **The middle stays put.** When the geographic board changes size (the
   pane takes half the width), a zoomed view keeps its zoom and moves so the
   plane point that was in the middle of the board is still in its middle
   (`keepMiddle` in `lib/geoMaps.ts`). A map never zoomed keeps fitting the
   whole plane, as before.
3. Phones (pane in the lower half) never remounted the page and are
   unchanged.
