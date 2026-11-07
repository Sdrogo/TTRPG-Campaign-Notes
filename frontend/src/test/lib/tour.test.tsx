import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  TOUR_CHAPTERS,
  TOUR_STEPS,
  chapterStart,
  setTourStep,
  stepIndex,
  stepPathname,
  stepUrl,
  tourStep,
  useGoToTourStep,
  useTourStep,
} from '../../lib/demo/tour';

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
    const index = stepIndex('document');

    act(() => result.current.go(index));

    expect(tourStep()).toBe(index);
    expect(result.current.location.pathname).toBe(TOUR_STEPS[index].path);
  });

  it('stays put when the step is on the same page', () => {
    const { result } = render('/rooms/demo/documents');
    const before = result.current.location.key;

    act(() => result.current.go(stepIndex('documentCard')));

    expect(result.current.location.key).toBe(before);
  });

  it('leaves a Player preview with a full page load', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    const { result } = render('/rooms/demo/documents?as=someone');

    act(() => result.current.go(0));

    expect(assign).toHaveBeenCalledWith(TOUR_STEPS[0].path);
  });

  it('enters a Player step with a full page load, the preview on', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    const { result } = render('/rooms/demo/documents');
    const index = stepIndex('playerDocuments');

    act(() => result.current.go(index));

    expect(assign).toHaveBeenCalledWith('/rooms/demo/documents?as=d3e0c0de-0000-4000-8000-000000000002');
  });

  it('moves between Player steps in place, keeping the preview', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    const { result } = render('/rooms/demo/documents?as=d3e0c0de-0000-4000-8000-000000000002');

    act(() => result.current.go(stepIndex('playerDocument')));

    expect(assign).not.toHaveBeenCalled();
    expect(result.current.location.pathname).toBe(stepPathname(TOUR_STEPS[stepIndex('playerDocument')]));
    expect(result.current.location.search).toContain('as=d3e0c0de-0000-4000-8000-000000000002');
  });

  it('opens a step whose page reads its query on mount with a full page load', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    const { result } = render('/rooms/demo/session-zero');
    const poll = TOUR_STEPS[stepIndex('poll')];

    act(() => result.current.go(stepIndex('poll')));

    expect(assign).toHaveBeenCalledWith(poll.path);
    expect(poll.path).toContain('?step=');
  });

  it('opens a step with a query in place when the page is another one', () => {
    const { result } = render('/rooms/demo/documents');

    act(() => result.current.go(stepIndex('sessionZero')));

    expect(result.current.location.pathname).toBe('/rooms/demo/session-zero');
    expect(result.current.location.search).toContain('?step=');
  });

  it('stays put on a page that already carries the step query', () => {
    const step = TOUR_STEPS[stepIndex('sessionZero')];
    const { result } = render(step.path);
    const before = result.current.location.key;

    act(() => result.current.go(stepIndex('sessionZero')));

    expect(result.current.location.key).toBe(before);
  });
});

describe('chapters', () => {
  it('start at their first step, in order, and the last step has none', () => {
    expect(TOUR_CHAPTERS.map(chapterStart)).toEqual([...TOUR_CHAPTERS.map(chapterStart)].sort((a, b) => a - b));
    expect(chapterStart('basics')).toBe(0);
    for (const chapter of TOUR_CHAPTERS) expect(TOUR_STEPS[chapterStart(chapter)].chapter).toBe(chapter);
    expect(TOUR_STEPS[TOUR_STEPS.length - 1].chapter).toBeNull();
  });

  it('keep every Player step together at the end, before the last card', () => {
    const player = TOUR_STEPS.map((step, index) => (step.viewer === 'player' ? index : -1)).filter((index) => index >= 0);
    expect(player).toEqual([chapterStart('player'), chapterStart('player') + 1, chapterStart('player') + 2]);
    expect(stepUrl(TOUR_STEPS[player[0]])).toContain('as=');
    expect(stepUrl(TOUR_STEPS[0])).toBe(TOUR_STEPS[0].path);
  });
});
