import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { TOUR_STEPS, setTourStep, stepIndex, tourStep, useGoToTourStep, useTourStep } from '../../lib/demo/tour';

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

function wrapper(route: string) {
  return ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>;
}

describe('tour state', () => {
  it('is closed until a step is set, and keeps the step for the tab', () => {
    expect(tourStep()).toBeNull();

    setTourStep(3);
    expect(tourStep()).toBe(3);
    expect(sessionStorage.getItem('exlibris.demo.tour')).toBe('3');

    setTourStep(null);
    expect(tourStep()).toBeNull();
  });

  it('reads a step out of range or garbled as the nearest real one', () => {
    sessionStorage.setItem('exlibris.demo.tour', '99');
    expect(tourStep()).toBe(TOUR_STEPS.length - 1);
    sessionStorage.setItem('exlibris.demo.tour', 'x');
    expect(tourStep()).toBe(0);
  });

  it('reads as closed, and changes nothing, when storage is blocked', () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);

    expect(() => setTourStep(2)).not.toThrow();
    expect(tourStep()).toBeNull();
  });

  it('finds a step by id, the first one for an unknown id', () => {
    expect(stepIndex('comments')).toBe(TOUR_STEPS.findIndex((step) => step.id === 'comments'));
    expect(stepIndex('nope')).toBe(0);
    expect(stepIndex(null)).toBe(0);
  });

  it('re-renders as the tour moves', () => {
    const { result } = renderHook(() => useTourStep());
    expect(result.current).toBeNull();

    act(() => setTourStep(4));
    expect(result.current).toBe(4);
  });
});

describe('useGoToTourStep', () => {
  function render(route: string) {
    return renderHook(() => ({ go: useGoToTourStep(), location: useLocation() }), { wrapper: wrapper(route) });
  }

  it('opens the step page in place', () => {
    const { result } = render('/rooms/demo/documents');

    act(() => result.current.go(6));

    expect(tourStep()).toBe(6);
    expect(result.current.location.pathname).toBe(TOUR_STEPS[6].path);
  });

  it('stays put when the step is on the same page', () => {
    const { result } = render('/rooms/demo/documents');
    const before = result.current.location.key;

    act(() => result.current.go(1));

    expect(result.current.location.key).toBe(before);
  });

  it('leaves a Player preview with a full page load', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    const { result } = render('/rooms/demo/documents?as=someone');

    act(() => result.current.go(0));

    expect(assign).toHaveBeenCalledWith(TOUR_STEPS[0].path);
  });
});
