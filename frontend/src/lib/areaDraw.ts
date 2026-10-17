import type { Corner } from '../types/geoMap';
import { MAX_AREA_POINTS, polygonSurface } from './geoMaps';
import type { Point } from './maps';

/**
 * Drawing a new area (spec 38 Decision 9): each click on the plane adds a
 * corner; a click back on the first corner, or "finish", closes the shape
 * once it has three corners and a surface. Pure, so the board only feeds it
 * clicks.
 */
export interface AreaDraft {
  corners: Corner[];
}

/** What a click did to the draft: the draft goes on, or the shape is closed. */
export type DraftStep = { draft: AreaDraft; closed: null } | { draft: null; closed: Corner[] };

/** An empty draft, before the first corner. */
export function startDraft(): AreaDraft {
  return { corners: [] };
}

/** A shape the backend takes: three corners or more, and a surface. */
export function canClose(draft: AreaDraft): boolean {
  return draft.corners.length >= 3 && polygonSurface(draft.corners) > 0;
}

/**
 * A click at `at`: within `closeRadius` of the first corner it closes a shape
 * that can be closed; otherwise it adds a corner (rounded), unless the shape
 * already has the most corners an area takes.
 */
export function clickDraft(draft: AreaDraft, at: Point, closeRadius: number): DraftStep {
  const first = draft.corners[0];
  if (first && canClose(draft) && Math.hypot(at.x - first[0], at.y - first[1]) <= closeRadius) {
    return { draft: null, closed: draft.corners };
  }
  if (draft.corners.length >= MAX_AREA_POINTS) return { draft, closed: null };
  return { draft: { corners: [...draft.corners, [Math.round(at.x), Math.round(at.y)]] }, closed: null };
}

/** The draft without its last corner. */
export function undoCorner(draft: AreaDraft): AreaDraft {
  return { corners: draft.corners.slice(0, -1) };
}
