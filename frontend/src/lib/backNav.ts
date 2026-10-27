import { matchPath, useLocation } from 'react-router-dom';

/**
 * Hierarchical "back" (not the browser history): a page's back arrow goes to
 * its fixed parent (Document -> Room, Room setup -> Room, Room -> Rooms list,
 * map -> maps list), unless the page was opened from somewhere else on
 * purpose - a map from a Document or the Room page, a Document from a map -
 * in which case the link that opened it carries that place in the navigation
 * state and back returns there.
 *
 * The state holds a short trail: `from` is the page it was opened from and
 * `backStack` the pages that one was opened from in turn, oldest first, so
 * back keeps walking it (Document -> map -> Document -> back -> map -> back
 * -> first Document). Back skips the Documents and maps on the trail that no
 * longer exist (Andrea, 2026-10-25).
 */
interface BackState {
  from?: unknown;
  backStack?: unknown;
}

export interface BackNavState {
  from: string;
  backStack?: string[];
}

/** The trail never grows past this: older places are dropped first. */
const MAX_TRAIL = 20;

/** Only in-app paths: a crafted state can never send the user off-site. */
function isInAppPath(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}

/** The trail in a navigation state, oldest first, the place it was opened from last. */
function readTrail(state: unknown): string[] {
  const { from, backStack } = (state as BackState | null) ?? {};
  if (!isInAppPath(from)) return [];
  const older = Array.isArray(backStack) ? backStack.filter(isInAppPath) : [];
  return [...older, from];
}

/** The navigation state that makes back walk `trail` (oldest first); undefined when it is empty. */
export function backStateFor(trail: string[]): BackNavState | undefined {
  if (trail.length === 0) return undefined;
  const from = trail[trail.length - 1];
  const backStack = trail.slice(Math.max(0, trail.length - MAX_TRAIL), -1);
  return backStack.length > 0 ? { from, backStack } : { from };
}

/**
 * The navigation state a link puts on its target so back returns to the
 * current page, and from there along the current page's own trail. Coming
 * back to a page already on the trail cuts the trail there, so going round
 * in circles never makes it longer.
 */
export function useBackState(): BackNavState {
  const { pathname, search, state } = useLocation();
  const here = `${pathname}${search}`;
  const trail = readTrail(state);
  const seen = trail.indexOf(here);
  return backStateFor([...(seen >= 0 ? trail.slice(0, seen) : trail), here])!;
}

/** Where a page's back arrow goes first: the place it was opened from, else its fixed parent. */
export function backDestination(state: unknown, fallback: string): string {
  return readTrail(state).at(-1) ?? fallback;
}

/** The places back may go, nearest first, ending with the fixed parent, each with the state to arrive with. */
export function backCandidates(state: unknown, fallback: string): { path: string; state?: BackNavState }[] {
  const trail = readTrail(state);
  const candidates = trail.map((path, index) => ({ path, state: backStateFor(trail.slice(0, index)) })).reverse();
  return [...candidates, { path: fallback }];
}

/** The Document or map a path shows, whose deletion makes back skip it; null for any other page. */
export function backTarget(
  path: string,
): { kind: 'document'; roomId: string; documentId: string } | { kind: 'map'; roomId: string; mapId: string } | null {
  const pathname = path.split(/[?#]/)[0];
  const document =
    matchPath('/rooms/:roomId/documents/:documentId', pathname) ??
    matchPath('/rooms/:roomId/documents/:documentId/mention-map', pathname);
  if (document) return { kind: 'document', roomId: document.params.roomId!, documentId: document.params.documentId! };
  const map = matchPath('/rooms/:roomId/maps/:mapId', pathname);
  if (map) return { kind: 'map', roomId: map.params.roomId!, mapId: map.params.mapId! };
  return null;
}
