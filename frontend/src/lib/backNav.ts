import { useLocation } from 'react-router-dom';

/**
 * Hierarchical "back" (not the browser history): a page's back arrow goes to
 * its fixed parent (Document -> Room, Room -> Rooms list, map -> maps list),
 * unless the page was opened from somewhere else on purpose - a map from a
 * Document, a Document from a map - in which case the link that opened it
 * carries that place in the navigation state and back returns there.
 */
interface BackState {
  from?: unknown;
}

/** The navigation state a link puts on its target so back returns to the current page. */
export function useBackState(): { from: string } {
  const { pathname, search } = useLocation();
  return { from: `${pathname}${search}` };
}

/** Where a page's back arrow goes: the place it was opened from, else its fixed parent. */
export function backDestination(state: unknown, fallback: string): string {
  const from = (state as BackState | null)?.from;
  // Only in-app paths: a crafted state can never send the user off-site.
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/\\') ? from : fallback;
}
