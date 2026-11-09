import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePageScroll } from '../../hooks/usePageScroll';

function wrapperAt(path: string, state?: unknown) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>{children}</MemoryRouter>
  );
}

/** A page scrolled to `y`, as the browser reports it. */
function scrollTo(y: number) {
  vi.advanceTimersByTime(250);
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  window.dispatchEvent(new Event('scroll'));
}

describe('usePageScroll (spec 66)', () => {
  const scrollSpy = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    scrollSpy.mockReset();
    window.scrollTo = scrollSpy as unknown as typeof window.scrollTo;
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });
  afterEach(() => vi.useRealTimers());

  it('scrolls back to where the page was left when it is reached by the back arrow', () => {
    const first = renderHook(() => usePageScroll(), { wrapper: wrapperAt('/rooms/r1/sections/s1') });
    scrollTo(640);
    first.unmount();
    scrollSpy.mockImplementation((_x: number, y: number) => Object.defineProperty(window, 'scrollY', { value: y, configurable: true }));

    renderHook(() => usePageScroll(), { wrapper: wrapperAt('/rooms/r1/sections/s1', { restoreScroll: true }) });

    expect(scrollSpy).toHaveBeenCalledWith(0, 640);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps trying while the content is not tall enough yet, then gives up', () => {
    const first = renderHook(() => usePageScroll(), { wrapper: wrapperAt('/rooms/r1/maps') });
    scrollTo(900);
    first.unmount();
    scrollSpy.mockImplementation(() => Object.defineProperty(window, 'scrollY', { value: 100, configurable: true }));

    renderHook(() => usePageScroll(), { wrapper: wrapperAt('/rooms/r1/maps', { restoreScroll: true }) });
    vi.advanceTimersByTime(500);
    const attempts = scrollSpy.mock.calls.length;
    vi.advanceTimersByTime(5000);

    expect(attempts).toBeGreaterThan(3);
    expect(scrollSpy.mock.calls.length).toBeLessThanOrEqual(2000 / 50 + 2);
  });

  it('stops when the reader scrolls on their own', () => {
    const first = renderHook(() => usePageScroll(), { wrapper: wrapperAt('/rooms/r1/clocks') });
    scrollTo(900);
    first.unmount();
    scrollSpy.mockImplementation(() => Object.defineProperty(window, 'scrollY', { value: 100, configurable: true }));

    renderHook(() => usePageScroll(), { wrapper: wrapperAt('/rooms/r1/clocks', { restoreScroll: true }) });
    window.dispatchEvent(new Event('wheel'));
    const attempts = scrollSpy.mock.calls.length;
    vi.advanceTimersByTime(1000);

    expect(scrollSpy.mock.calls.length).toBe(attempts);
  });

  it('ignores the scroll events of the first moments, which are the old position settling', () => {
    const first = renderHook(() => usePageScroll(), { wrapper: wrapperAt('/rooms/r1/members') });
    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    first.unmount();

    renderHook(() => usePageScroll(), { wrapper: wrapperAt('/rooms/r1/members', { restoreScroll: true }) });

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('stops for the keys and the scrollbar too', () => {
    const first = renderHook(() => usePageScroll(), { wrapper: wrapperAt('/rooms/r1/friends') });
    scrollTo(900);
    first.unmount();
    scrollSpy.mockImplementation(() => Object.defineProperty(window, 'scrollY', { value: 100, configurable: true }));

    renderHook(() => usePageScroll(), { wrapper: wrapperAt('/rooms/r1/friends', { restoreScroll: true }) });
    window.dispatchEvent(new Event('keydown'));
    const attempts = scrollSpy.mock.calls.length;
    vi.advanceTimersByTime(1000);

    expect(scrollSpy.mock.calls.length).toBe(attempts);
  });

  it('leaves a page opened any other way at the top', () => {
    const first = renderHook(() => usePageScroll(), { wrapper: wrapperAt('/rooms/r1/documents') });
    scrollTo(300);
    first.unmount();

    renderHook(() => usePageScroll(), { wrapper: wrapperAt('/rooms/r1/documents') });
    renderHook(() => usePageScroll(), { wrapper: wrapperAt('/rooms/r1/setup', { restoreScroll: true }) });

    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
