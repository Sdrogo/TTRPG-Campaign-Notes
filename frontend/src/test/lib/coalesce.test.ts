import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCoalescer } from '../../lib/coalesce';

let held: boolean;
const run = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  held = false;
  run.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

function coalescer() {
  return createCoalescer(run, 1_000, () => held, () => Date.now());
}

describe('createCoalescer (spec 52 Decision 5)', () => {
  it('reads at once, then gathers a burst into one read a second', () => {
    const reread = coalescer();
    reread.request();
    expect(run).toHaveBeenCalledOnce();

    reread.request();
    reread.request();
    vi.advanceTimersByTime(999);
    expect(run).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(5_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps an event that arrives during a drag for exactly one read after the pointer is up', () => {
    const reread = coalescer();
    held = true;
    reread.request();
    reread.request();
    vi.advanceTimersByTime(5_000);
    expect(run).not.toHaveBeenCalled();

    held = false;
    reread.release();
    expect(run).toHaveBeenCalledOnce();
    reread.release();
    expect(run).toHaveBeenCalledOnce();
  });

  it('waits for the gap too when the pointer is let go right after a read', () => {
    const reread = coalescer();
    reread.request();
    held = true;
    reread.request();
    vi.advanceTimersByTime(200);
    held = false;
    reread.release();
    expect(run).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(800);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('forgets what is pending once cancelled', () => {
    const reread = coalescer();
    reread.request();
    reread.request();
    reread.cancel();
    vi.advanceTimersByTime(2_000);
    reread.release();
    expect(run).toHaveBeenCalledOnce();
  });

  it('reads the clock itself by default', () => {
    const reread = createCoalescer(run, 1_000, () => false);
    reread.request();
    expect(run).toHaveBeenCalledOnce();
  });
});
