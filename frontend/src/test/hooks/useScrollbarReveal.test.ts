import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScrollbarReveal } from '../../hooks/useScrollbarReveal';

const revealed = () => document.documentElement.hasAttribute('data-scrolling');

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useScrollbarReveal', () => {
  it('shows the scrollbar while the page scrolls, then hides it again', () => {
    renderHook(() => useScrollbarReveal());
    expect(revealed()).toBe(false);

    fireEvent.scroll(window);
    expect(revealed()).toBe(true);

    act(() => vi.advanceTimersByTime(500));
    fireEvent.scroll(window);
    act(() => vi.advanceTimersByTime(500));
    expect(revealed()).toBe(true);

    act(() => vi.advanceTimersByTime(300));
    expect(revealed()).toBe(false);
  });

  it('shows it when the pointer reaches the right edge, not elsewhere', () => {
    renderHook(() => useScrollbarReveal());

    fireEvent.pointerMove(window, { clientX: window.innerWidth / 2 });
    expect(revealed()).toBe(false);

    fireEvent.pointerMove(window, { clientX: window.innerWidth - 5 });
    expect(revealed()).toBe(true);
  });

  it('stops listening and hides it when unmounted', () => {
    const { unmount } = renderHook(() => useScrollbarReveal());
    fireEvent.scroll(window);

    unmount();
    expect(revealed()).toBe(false);
    fireEvent.scroll(window);
    expect(revealed()).toBe(false);
  });
});
