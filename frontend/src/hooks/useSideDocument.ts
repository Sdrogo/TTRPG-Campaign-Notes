import { createContext, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { GeoItemRef } from '../lib/geoMaps';

/** The address parameter holding the Document open beside the page (spec 37 Decision 3). */
export const SIDE_PARAM = 'side';

/** What starts a geographic map's plain place in `?side=` (spec 50 Decision 2). */
const PLACE_PREFIX = 'place:';

/** The `?side=` value showing a geographic map's plain area or pin (spec 50). */
export function placeSide(ref: GeoItemRef): string {
  return `${PLACE_PREFIX}${ref.kind}:${ref.id}`;
}

/** Whether a `?side=` value names a map place rather than a Document. */
export function isPlaceSide(sideId: string | null): boolean {
  return sideId?.startsWith(PLACE_PREFIX) ?? false;
}

/** The place a `?side=` value names, or null when it names none. */
export function parsePlaceSide(sideId: string | null): GeoItemRef | null {
  if (!sideId || !isPlaceSide(sideId)) return null;
  const [kind, id] = sideId.slice(PLACE_PREFIX.length).split(':');
  return (kind === 'area' || kind === 'pin') && id ? { kind, id } : null;
}

/** Wide enough for two panes side by side, and for the open menu (spec 37 Decision 5). */
export const SPLIT_QUERY = '(min-width: 48em)';

/**
 * Whether the open menu around this element is showing: a Document preview
 * inside it stays shut meanwhile, so it never covers the menu (spec 37).
 */
export const OpenMenuContext = createContext(false);

export interface SideDocument {
  /**
   * The Document in the pane, '' when the pane is open with nothing picked
   * yet (a map's split, before a card is selected), or null when the page has
   * the whole width.
   */
  sideId: string | null;
  open: (documentId: string) => void;
  close: () => void;
}

/**
 * The Document open in the half-screen pane, kept in the address so a reload
 * keeps it (spec 37 Decision 3); opening or closing it replaces the current
 * history entry, so the browser's Back leaves the page instead of stepping
 * through every pane change, with ways to open one
 * there (replacing any other) and to close it.
 */
export function useSideDocument(): SideDocument {
  const [params, setParams] = useSearchParams();
  const sideId = params.get(SIDE_PARAM);
  const open = useCallback(
    (documentId: string) =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set(SIDE_PARAM, documentId);
        return next;
      }, { replace: true }),
    [setParams],
  );
  const close = useCallback(
    () =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.delete(SIDE_PARAM);
        return next;
      }, { replace: true }),
    [setParams],
  );
  return { sideId, open, close };
}
