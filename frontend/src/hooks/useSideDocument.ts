import { createContext, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/** The address parameter holding the Document open beside the page (spec 37 Decision 3). */
export const SIDE_PARAM = 'side';

/** Wide enough for two panes side by side, and for the open menu (spec 37 Decision 5). */
export const SPLIT_QUERY = '(min-width: 48em)';

/**
 * Whether the open menu around this element is showing: a Document preview
 * inside it stays shut meanwhile, so it never covers the menu (spec 37).
 */
export const OpenMenuContext = createContext(false);

export interface SideDocument {
  /** The Document in the pane, or null when the page has the whole width. */
  sideId: string | null;
  open: (documentId: string) => void;
  close: () => void;
}

/**
 * The Document open in the half-screen pane, kept in the address so a reload
 * or the Back button keeps it (spec 37 Decision 3), with ways to open one
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
      }),
    [setParams],
  );
  const close = useCallback(
    () =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.delete(SIDE_PARAM);
        return next;
      }),
    [setParams],
  );
  return { sideId, open, close };
}
