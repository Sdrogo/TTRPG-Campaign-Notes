import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** The scroll position each page was last left at, by address; lives as long as the tab. */
const positions = new Map<string, number>();
/** How long a restored page waits for its content to be tall enough to reach the position. */
const RESTORE_WINDOW_MS = 2000;
const RESTORE_STEP_MS = 50;
/** The scroll events right after a page appears are the browser settling the old position, not the reader. */
const SETTLE_MS = 200;
/** What means the reader took over the scroll: wheel and touch, but also the scrollbar and the keys. */
const TAKE_OVER = ['wheel', 'touchmove', 'pointerdown', 'keydown'] as const;

/**
 * Remembers where each page was scrolled to and, when the page was reached
 * by the header's back arrow (`restoreScroll` in the navigation state,
 * `useHierarchicalBack`), scrolls back there, so coming back from a Document
 * to a Section does not start from the top (spec 66). The content loads
 * after the page mounts, so it retries for a moment, and gives up as soon as
 * the reader takes over. Scroll events in the first moments of a page are
 * ignored, so the old page's position settling never overwrites the new one.
 */
export function usePageScroll() {
  const { pathname, search, state } = useLocation();
  const key = `${pathname}${search}`;
  const restore = (state as { restoreScroll?: boolean } | null)?.restoreScroll === true;

  useEffect(() => {
    const shown = Date.now();
    const remember = () => {
      if (Date.now() - shown >= SETTLE_MS) positions.set(key, window.scrollY);
    };
    window.addEventListener('scroll', remember, { passive: true });
    return () => window.removeEventListener('scroll', remember);
  }, [key]);

  useEffect(() => {
    const target = positions.get(key);
    if (!restore || !target) return;
    let timer: number | undefined;
    const stop = () => window.clearTimeout(timer);
    const started = Date.now();
    const attempt = () => {
      window.scrollTo(0, target);
      if (Math.abs(window.scrollY - target) > 2 && Date.now() - started < RESTORE_WINDOW_MS) {
        timer = window.setTimeout(attempt, RESTORE_STEP_MS);
      }
    };
    attempt();
    for (const type of TAKE_OVER) window.addEventListener(type, stop, { passive: true, once: true });
    return () => {
      stop();
      for (const type of TAKE_OVER) window.removeEventListener(type, stop);
    };
  }, [key, restore]);
}
