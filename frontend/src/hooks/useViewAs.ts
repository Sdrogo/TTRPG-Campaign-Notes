import { createContext, useContext } from 'react';

/** The member the Master views a Room as (spec 22b), and that Room. */
export interface ViewAs {
  roomId: string;
  userId: string;
}

/** Set by `ViewAsProvider`; null outside a preview. */
export const ViewAsContext = createContext<ViewAs | null>(null);

/** The preview in progress, or null on the signed-in user's own view. */
export function useViewAs(): ViewAs | null {
  return useContext(ViewAsContext);
}

/**
 * Whether the page is read-only because the Master previews it as someone
 * else (spec 22b Decision 3): every write control is hidden, and the backend
 * refuses writes anyway.
 */
export function useReadOnly(): boolean {
  return useViewAs() !== null;
}
