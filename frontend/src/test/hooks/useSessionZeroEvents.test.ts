import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/apiClient';
import { setDemoMode } from '../../lib/demo/demoMode';
import { readBoardEvents, type BoardEvent } from '../../lib/sessionZeroEvents';
import { toSessionZero, type RawSessionZero } from '../../lib/sessionZero';
import { rawSessionZero } from '../fixtures';
import { createTestQueryClient, renderHookWithProviders } from '../utils';
import { sessionZeroQueryKey } from '../../hooks/useSessionZero';
import {
  FALLBACK_REFRESH_MS,
  GLOW_MS,
  RETRY_DELAYS_MS,
  useSessionZeroEvents,
} from '../../hooks/useSessionZeroEvents';

vi.mock('../../lib/sessionZeroEvents', () => ({ readBoardEvents: vi.fn() }));

const readMock = vi.mocked(readBoardEvents);

/** One opening of the stream, driven by the test. */
interface Stream {
  signal: AbortSignal;
  open: () => void;
  send: (event: BoardEvent) => void;
  close: () => Promise<void>;
  fail: (error: unknown) => Promise<void>;
}

let streams: Stream[];
let visibility: DocumentVisibilityState;

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function render(revision = 5) {
  const queryClient = createTestQueryClient();
  queryClient.setDefaultOptions({ queries: { gcTime: Infinity } });
  queryClient.setQueryData(
    [...sessionZeroQueryKey('room-1'), 'open'],
    toSessionZero(rawSessionZero({ revision }) as RawSessionZero),
  );
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
  const onReset = vi.fn();
  const hook = renderHookWithProviders(() => useSessionZeroEvents('room-1', onReset), { queryClient });
  return { ...hook, invalidate, onReset };
}

beforeEach(() => {
  vi.useFakeTimers();
  streams = [];
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  readMock.mockReset();
  readMock.mockImplementation(
    (_roomId, signal, onOpen, onEvent) =>
      new Promise<void>((resolve, reject) => {
        streams.push({
          signal,
          open: () => act(() => onOpen()),
          send: (event) => act(() => onEvent(event)),
          close: () => act(async () => resolve()),
          fail: (error) => act(async () => reject(error)),
        });
      }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setDemoMode(false);
});

describe('useSessionZeroEvents', () => {
  it("opens the Room's stream and reads the boards again on each event", () => {
    const { invalidate } = render();
    expect(readMock).toHaveBeenCalledWith('room-1', expect.any(AbortSignal), expect.any(Function), expect.any(Function));
    streams[0].open();
    expect(invalidate).not.toHaveBeenCalled();

    streams[0].send({ revision: 6, kind: 'timer', id: null });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: sessionZeroQueryKey('room-1') });
  });

  it("makes another member's change glow for a moment, never the viewer's own", () => {
    const { result } = render(5);
    streams[0].open();

    streams[0].send({ revision: 5, kind: 'card', id: 'mine' });
    expect(result.current.has('mine')).toBe(false);

    streams[0].send({ revision: 6, kind: 'card', id: 'card-1' });
    streams[0].send({ revision: 7, kind: 'group', id: 'group-1' });
    expect([...result.current]).toEqual(['card-1', 'group-1']);

    act(() => vi.advanceTimersByTime(GLOW_MS));
    expect(result.current.size).toBe(0);
  });

  it('glows nothing before the boards are read', () => {
    const queryClient = createTestQueryClient();
    const { result } = renderHookWithProviders(() => useSessionZeroEvents('room-1', vi.fn()), { queryClient });
    streams[0].send({ revision: 1, kind: 'card', id: 'card-1' });
    expect(result.current.size).toBe(0);
  });

  it('goes back to the open round when the Session 0 is deleted', () => {
    const { onReset, invalidate, result } = render();
    streams[0].send({ revision: 6, kind: 'reset', id: null });
    expect(onReset).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalled();
    expect(result.current.size).toBe(0);
  });

  it('opens the stream again after a growing pause, reading the boards every 30 s meanwhile', async () => {
    const { invalidate } = render();
    streams[0].open();
    await streams[0].close();

    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[0] - 1));
    expect(streams).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(streams).toHaveLength(2);

    await streams[1].fail(new TypeError('Failed to fetch'));
    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[1] - 1));
    expect(streams).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1));
    expect(streams).toHaveLength(3);

    // Never longer than the last pause.
    for (let failed = 3; failed <= RETRY_DELAYS_MS.length + 1; failed += 1) {
      await streams.at(-1)!.fail(new ApiError(503, 'down'));
      act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS.at(-1)!));
    }
    expect(streams).toHaveLength(RETRY_DELAYS_MS.length + 2);
    expect(invalidate).toHaveBeenCalled();

    // Back: read once for what was missed, and the 30 s reads stop.
    invalidate.mockClear();
    streams.at(-1)!.open();
    expect(invalidate).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(FALLBACK_REFRESH_MS * 2));
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('reads the boards every 30 s while the stream is down', async () => {
    const { invalidate } = render();
    await streams[0].fail(new TypeError('Failed to fetch'));
    readMock.mockImplementation(() => new Promise(() => {}));
    act(() => vi.advanceTimersByTime(FALLBACK_REFRESH_MS));
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('stops for good when the stream is refused', async () => {
    render();
    await streams[0].fail(new ApiError(403, 'Not a member'));
    act(() => vi.advanceTimersByTime(FALLBACK_REFRESH_MS));
    expect(streams).toHaveLength(1);
  });

  it('closes the stream while the tab is hidden and reads the boards when it is back', async () => {
    const { invalidate, result } = render();
    streams[0].open();
    streams[0].send({ revision: 6, kind: 'card', id: 'card-1' });
    invalidate.mockClear();
    setVisibility('hidden');
    expect(result.current.size).toBe(0);
    expect(streams[0].signal.aborted).toBe(true);
    await streams[0].fail(new DOMException('aborted', 'AbortError'));
    act(() => vi.advanceTimersByTime(FALLBACK_REFRESH_MS));
    expect(streams).toHaveLength(1);
    expect(invalidate).not.toHaveBeenCalled();

    setVisibility('visible');
    expect(streams).toHaveLength(2);
    streams[1].open();
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('opens nothing in a hidden tab, in the Demo, and stops on unmount', () => {
    visibility = 'hidden';
    render();
    expect(readMock).not.toHaveBeenCalled();

    visibility = 'visible';
    setDemoMode(true);
    render();
    expect(readMock).not.toHaveBeenCalled();

    setDemoMode(false);
    const { unmount } = render();
    unmount();
    expect(streams[0].signal.aborted).toBe(true);
  });
});
