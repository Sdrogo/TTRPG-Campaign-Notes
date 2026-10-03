import { useEffect } from 'react';

// How long the scrollbar stays visible after the last scroll, in ms.
const REVEAL_FOR = 800;
// How close to the window's right edge the pointer brings the scrollbar back,
// in px, so it can be grabbed without scrolling first.
const EDGE_ZONE = 24;

/**
 * Shows the page's scrollbar (`data-scrolling` on `<html>`, styled in
 * `index.css`) while the page scrolls or the pointer is at the right edge,
 * and fades it out otherwise (Andrea, 2026-10-03). Called once by `App`, so
 * it covers every page.
 */
export function useScrollbarReveal() {
  useEffect(() => {
    const root = document.documentElement;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const reveal = () => {
      root.dataset.scrolling = '';
      clearTimeout(timer);
      timer = setTimeout(() => delete root.dataset.scrolling, REVEAL_FOR);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.clientX >= window.innerWidth - EDGE_ZONE) reveal();
    };

    window.addEventListener('scroll', reveal, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      window.removeEventListener('scroll', reveal);
      window.removeEventListener('pointermove', onPointerMove);
      clearTimeout(timer);
      delete root.dataset.scrolling;
    };
  }, []);
}
