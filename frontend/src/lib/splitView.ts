// The split view's width (spec 37 Decision 3).

/** Where the chosen width is remembered, for this viewer only (spec 37 Decision 3). */
export const SPLIT_STORAGE_KEY = 'splitView.ratio';
/** Neither pane gets narrower than this, in pixels. */
export const MIN_PANE_WIDTH = 320;
/** How far an arrow key moves the divider, as a share of the width. */
export const KEY_STEP = 0.05;

/** The remembered left pane's share of the width, or half when none is stored or storage is blocked. */
export function storedRatio(): number {
  try {
    const value = Number(window.localStorage.getItem(SPLIT_STORAGE_KEY));
    return value > 0 && value < 1 ? value : 0.5;
  } catch {
    return 0.5;
  }
}

/** Remembers the left pane's share for this viewer; skipped silently if storage is blocked. */
export function storeRatio(ratio: number): void {
  try {
    window.localStorage.setItem(SPLIT_STORAGE_KEY, String(ratio));
  } catch {
    // Storage blocked: the width just isn't remembered.
  }
}

/** `ratio` kept so both panes are at least MIN_PANE_WIDTH wide in `width`. */
export function clampRatio(ratio: number, width: number): number {
  if (width <= 2 * MIN_PANE_WIDTH) {
    return 0.5;
  }
  const min = MIN_PANE_WIDTH / width;
  return Math.min(1 - min, Math.max(min, ratio));
}
