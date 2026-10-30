/**
 * Gathers requests to read something again into at most one read per
 * `gapMs`, and none while `held()` (a pointer is down on a map, spec 52
 * Decision 5). A request is never dropped: it stays pending until the gap
 * has passed and nothing is held, whichever comes later, then one read
 * answers every request made meanwhile. `release` says the hold is over.
 */
export interface Coalescer {
  request: () => void;
  release: () => void;
  cancel: () => void;
}

export function createCoalescer(
  run: () => void,
  gapMs: number,
  held: () => boolean,
  now: () => number = () => Date.now(),
): Coalescer {
  let pending = false;
  let lastRun = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    if (!pending || timer !== undefined || held()) return;
    const wait = lastRun + gapMs - now();
    if (wait > 0) {
      timer = setTimeout(() => {
        timer = undefined;
        flush();
      }, wait);
      return;
    }
    pending = false;
    lastRun = now();
    run();
  };

  return {
    request: () => {
      pending = true;
      flush();
    },
    release: flush,
    cancel: () => {
      clearTimeout(timer);
      timer = undefined;
      pending = false;
    },
  };
}
