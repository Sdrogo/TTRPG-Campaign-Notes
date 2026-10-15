import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampRatio, SPLIT_STORAGE_KEY, storedRatio, storeRatio } from '../../lib/splitView';

describe('split view width (spec 37)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('starts at half, then remembers the chosen share', () => {
    expect(storedRatio()).toBe(0.5);
    storeRatio(0.3);
    expect(window.localStorage.getItem(SPLIT_STORAGE_KEY)).toBe('0.3');
    expect(storedRatio()).toBe(0.3);
    window.localStorage.setItem(SPLIT_STORAGE_KEY, '7');
    expect(storedRatio()).toBe(0.5);
  });

  it('works without storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(storedRatio()).toBe(0.5);
    expect(() => storeRatio(0.4)).not.toThrow();
  });

  it('keeps both panes at least 320 px wide', () => {
    expect(clampRatio(0.1, 1000)).toBe(0.32);
    expect(clampRatio(0.9, 1000)).toBeCloseTo(0.68);
    expect(clampRatio(0.4, 1000)).toBe(0.4);
    expect(clampRatio(0.2, 600)).toBe(0.5);
  });
});
