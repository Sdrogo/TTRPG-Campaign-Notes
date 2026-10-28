import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Box } from '@mantine/core';
import { useTranslation } from 'react-i18next';

/** Lines & Veils' starting share of the page, in percent (spec 46c Decision 10). */
export const DEFAULT_SIDE_PERCENT = 100 / 3;
/** The widest Lines & Veils gets, in percent of the page. */
export const MAX_SIDE_PERCENT = 60;
/** The narrowest, in pixels. */
export const MIN_SIDE_PX = 280;
/** The boards never get shorter than this, in pixels: below it the page scrolls. */
export const MIN_BOARDS_HEIGHT = 360;
/** The space left under the boards, the page's bottom padding. */
const BOTTOM_GAP_PX = 16;
/** How far an arrow key moves the handle, in percent. */
const KEY_STEP_PERCENT = 2;

const STORAGE_KEY = 'sessionZero:linesVeilsWidth';

/**
 * The width last picked, in this browser only. A convenience: storage can be
 * unavailable (private window, blocked site data), and then it starts at a third.
 */
function readSaved(): number {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return saved > 0 && saved <= MAX_SIDE_PERCENT ? saved : DEFAULT_SIDE_PERCENT;
  } catch {
    return DEFAULT_SIDE_PERCENT;
  }
}

function save(percent: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(percent));
  } catch {
    // Nothing to do: the next visit starts at a third.
  }
}

interface BoardsSplitProps {
  left: ReactNode;
  right: ReactNode;
}

/**
 * The Retro board and Lines & Veils side by side on a wide screen, with a
 * handle between them (spec 46c Decision 10): dragging it, or its arrow keys
 * (Home and End go to the limits), widens one and narrows the other. Lines
 * & Veils stays between 280px and 60% of the page; a double click puts it
 * back to a third. The width is remembered in this browser.
 *
 * The two fill the screen's height under the header and each scrolls on its
 * own (spec 46d Decision 5), fitted again when the window or the page
 * above them changes size.
 */
export function BoardsSplit({ left, right }: BoardsSplitProps) {
  const { t } = useTranslation();
  const frame = useRef<HTMLDivElement>(null);
  const [percent, setPercent] = useState(readSaved);
  const [dragging, setDragging] = useState(false);
  const [height, setHeight] = useState<number>();

  useLayoutEffect(() => {
    const fit = () => {
      const top = frame.current!.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(MIN_BOARDS_HEIGHT, window.innerHeight - top - BOTTOM_GAP_PX));
    };
    fit();
    window.addEventListener('resize', fit);
    // The header above can grow or shrink with no window resize (a button
    // comes, the row wraps): the page's height moves with it.
    const observer = new ResizeObserver(fit);
    observer.observe(document.body);
    return () => {
      window.removeEventListener('resize', fit);
      observer.disconnect();
    };
  }, []);

  // The narrowest share the page's width allows, never above the widest.
  const clamp = (value: number) => {
    const width = frame.current!.getBoundingClientRect().width;
    const min = width > 0 ? Math.min((MIN_SIDE_PX / width) * 100, MAX_SIDE_PERCENT) : 0;
    return Math.min(MAX_SIDE_PERCENT, Math.max(min, value));
  };
  const apply = (value: number) => {
    const next = clamp(value);
    setPercent(next);
    save(next);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const rect = frame.current!.getBoundingClientRect();
    if (rect.width > 0) apply(((rect.right - event.clientX) / rect.width) * 100);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowLeft: percent + KEY_STEP_PERCENT,
      ArrowRight: percent - KEY_STEP_PERCENT,
      Home: MAX_SIDE_PERCENT,
      End: 0,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    apply(moves[event.key]);
  };

  return (
    <Box ref={frame} style={{ display: 'flex', height }}>
      <Box className="sz-pane" style={{ flex: '1 1 0', minWidth: 0 }}>
        {left}
      </Box>
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={t('sessionZero.resize')}
        aria-valuemin={0}
        aria-valuemax={MAX_SIDE_PERCENT}
        aria-valuenow={Math.round(percent)}
        className="sz-split-handle"
        data-dragging={dragging || undefined}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onDoubleClick={() => apply(DEFAULT_SIDE_PERCENT)}
        onKeyDown={onKeyDown}
      />
      <Box className="sz-pane" style={{ flex: `0 0 ${percent}%`, minWidth: MIN_SIDE_PX }}>
        {right}
      </Box>
    </Box>
  );
}
