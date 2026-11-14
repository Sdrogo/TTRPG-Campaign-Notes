import { useLayoutEffect, useState, type RefObject } from 'react';

/** Before the first measure: about the header, the page title and the margins. */
export const FILL_HEIGHT_FALLBACK = 'calc(100dvh - 190px)';
/** The page's bottom margin (`PageLayout`'s `py="md"`). */
const BOTTOM_MARGIN = 16;

/**
 * The height that takes an element from where it starts on the page down to
 * the bottom of the screen, less the page's bottom margin: a full-page map
 * fills the screen exactly, with no empty band under it and no page scroll,
 * whatever the header and title above it measure. Measured again when the
 * window or the page changes size. With `enabled` false it is left alone.
 */
export function useFillHeight(ref: RefObject<HTMLElement | null>, enabled = true): string {
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!enabled) return;
    // The layout effect runs once the element is on the page.
    const measure = () => setTop(Math.round(ref.current!.getBoundingClientRect().top + window.scrollY));
    measure();
    window.addEventListener('resize', measure);
    // What is above can change size (a title wrapping, a banner): the page's height changes with it.
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => {
      window.removeEventListener('resize', measure);
      observer.disconnect();
    };
  }, [ref, enabled]);
  return top === null ? FILL_HEIGHT_FALLBACK : `calc(100dvh - ${top + BOTTOM_MARGIN}px)`;
}
