import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/apiClient';
import { readRoomEvents, type RoomEvent } from '../../lib/roomEvents';
import { renderHookWithProviders } from '../utils';
import { useRoomEvents } from '../../hooks/useRoomEvents';

vi.mock('../../lib/roomEvents', () => ({ readRoomEvents: vi.fn() }));

const readMock = vi.mocked(readRoomEvents);

interface Stream {
  roomId: string;
  signal: AbortSignal;
  open: () => void;
  send: (event: RoomEvent) => void;
  close: () => Promise<void>;
  refuse: () => Promise<void>;
}

let streams: Stream[];
let visibility: DocumentVisibilityState;

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  streams = [];
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  readMock.mockReset();
  readMock.mockImplementation(
    (roomId, signal, onOpen, onEvent) =>
      new Promise<void>((resolve, reject) => {
        streams.push({
          roomId,
          signal,
          open: () => act(() => onOpen()),
          send: (event) => act(() => onEvent(event)),
          close: () => act(async () => resolve()),
          refuse: () => act(async () => reject(new ApiError(404, 'No such Room'))),
        });
      }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const EVENT: RoomEvent = { topic: 'map', revision: 3, kind: 'changed', id: 'map-1' };

describe('useRoomEvents (spec 52 Decision 1)', () => {
  it('shares one stream per Room among the listeners of a tab', () => {
    const first = vi.fn();
    const second = vi.fn();
    const one = renderHookWithProviders(() => useRoomEvents('room-1', first, vi.fn()));
    const two = renderHookWithProviders(() => useRoomEvents('room-1', second, vi.fn()));
    const other = renderHookWithProviders(() => useRoomEvents('room-2', vi.fn(), vi.fn()));
    expect(streams.map((stream) => stream.roomId)).toEqual(['room-1', 'room-2']);
    expect(one.result.current).toBe('connecting');

    streams[0].open();
    expect(two.result.current).toBe('open');
    streams[0].send(EVENT);
    expect(first).toHaveBeenCalledWith(EVENT);
    expect(second).toHaveBeenCalledWith(EVENT);

    // Open while a listener is left; closed with the last one.
    one.unmount();
    expect(streams[0].signal.aborted).toBe(false);
    two.unmount();
    expect(streams[0].signal.aborted).toBe(true);
    other.unmount();
  });

  it('tells every listener when the stream is back after a drop', async () => {
    const onReopen = vi.fn();
    const { result, unmount } = renderHookWithProviders(() => useRoomEvents('room-1', vi.fn(), onReopen));
    streams[0].open();
    expect(onReopen).not.toHaveBeenCalled();

    await streams[0].close();
    expect(result.current).toBe('down');
    act(() => vi.advanceTimersByTime(1_000));
    streams[1].open();
    expect(onReopen).toHaveBeenCalledOnce();
    expect(result.current).toBe('open');
    unmount();
  });

  it('stops retrying once the last listener leaves', async () => {
    const { unmount } = renderHookWithProviders(() => useRoomEvents('room-1', vi.fn(), vi.fn()));
    await streams[0].close();
    unmount();
    act(() => vi.advanceTimersByTime(60_000));
    expect(streams).toHaveLength(1);
  });

  it('keeps an open stream as it is when the tab says it is visible again', () => {
    const { result, unmount } = renderHookWithProviders(() => useRoomEvents('room-1', vi.fn(), vi.fn()));
    streams[0].open();
    setVisibility('visible');
    expect(streams).toHaveLength(1);
    expect(result.current).toBe('open');
    unmount();
  });

  it('never opens a refused stream again, even when the tab comes back', async () => {
    const { result, unmount } = renderHookWithProviders(() => useRoomEvents('room-1', vi.fn(), vi.fn()));
    await streams[0].refuse();
    expect(result.current).toBe('refused');
    setVisibility('hidden');
    setVisibility('visible');
    expect(streams).toHaveLength(1);
    expect(result.current).toBe('refused');
    unmount();
  });
});
