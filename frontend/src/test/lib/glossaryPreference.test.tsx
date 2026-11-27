import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setGlossaryHighlight, useGlossaryHighlight } from '../../lib/glossaryPreference';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('the Glossary highlight switch of this device', () => {
  it('is on until switched off, and every reader follows the change', () => {
    const { result } = renderHook(() => useGlossaryHighlight());
    expect(result.current).toBe(true);

    act(() => setGlossaryHighlight(false));
    expect(result.current).toBe(false);
    expect(window.localStorage.getItem('ttrpg.glossaryHighlight')).toBe('off');

    act(() => setGlossaryHighlight(true));
    expect(result.current).toBe(true);
  });

  it('follows a change made in another tab', () => {
    const { result } = renderHook(() => useGlossaryHighlight());
    window.localStorage.setItem('ttrpg.glossaryHighlight', 'off');

    act(() => {
      window.dispatchEvent(new StorageEvent('storage'));
    });

    expect(result.current).toBe(false);
  });

  it('stays on, and does not throw, where storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useGlossaryHighlight());

    act(() => setGlossaryHighlight(false));

    expect(result.current).toBe(true);
  });
});
