import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRoomEvents, type RoomEvent } from '../../lib/roomEvents';
import { createTestQueryClient, renderHookWithProviders } from '../utils';
import { MAP_REREAD_GAP_MS, useMapEvents } from '../../hooks/useMapEvents';

vi.mock('../../lib/roomEvents', () => ({ readRoomEvents: vi.fn() }));

const readMock = vi.mocked(readRoomEvents);
const MAP_KEY = ['rooms', 'room-1', 'maps', 'map-1'];

interface Stream {
  open: () => void;
  send: (event: RoomEvent) => void;
  fail: () => Promise<void>;
}

let streams: Stream[];

beforeEach(() => {
  vi.useFakeTimers();
  streams = [];
  readMock.mockReset();
  readMock.mockImplementation(
    (_roomId, _signal, onOpen, onEvent) =>
      new Promise<void>((_resolve, reject) => {
        streams.push({
          open: () => act(() => onOpen()),
          send: (event) => act(() => onEvent(event)),
          fail: () => act(async () => reject(new TypeError('Failed to fetch'))),
        });
      }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function render(revision: number | null = 4, geoRevision?: number) {
  const queryClient = createTestQueryClient();
  queryClient.setDefaultOptions({ queries: { gcTime: Infinity } });
  if (revision !== null) queryClient.setQueryData(MAP_KEY, { revision });
  if (geoRevision !== undefined) queryClient.setQueryData([...MAP_KEY, 'geo'], { revision: geoRevision });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
  const hook = renderHookWithProviders(() => useMapEvents('room-1', 'map-1'), { queryClient });
  streams[0].open();
  return { ...hook, invalidate };
}

function mapEvent(revision: number | null, kind = 'changed', id = 'map-1'): RoomEvent {
  return { topic: 'map', revision, kind, id };
}

function pointer(type: 'pointerdown' | 'pointerup') {
  act(() => {
    window.dispatchEvent(new Event(type));
  });
}

describe('useMapEvents (spec 52_2)', () => {
  it("reads the map again on another member's change, not on the viewer's own", () => {
    const { invalidate } = render(4, 6);
    streams[0].send(mapEvent(6));
    expect(invalidate).not.toHaveBeenCalled();

    streams[0].send(mapEvent(7));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: MAP_KEY });
  });

  it('reads it on any change before the map is loaded', () => {
    const { invalidate } = render(null);
    streams[0].send(mapEvent(1));
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('reads it on any Document event and on a map event without a revision', () => {
    const { invalidate } = render();
    streams[0].send({ topic: 'document', revision: null, kind: 'changed', id: 'doc-1' });
    expect(invalidate).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(MAP_REREAD_GAP_MS));
    streams[0].send(mapEvent(null));
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('ignores other maps and the other topics', () => {
    const { invalidate } = render();
    streams[0].send(mapEvent(9, 'changed', 'map-2'));
    streams[0].send({ topic: 'session_zero', revision: 9, kind: 'card', id: 'card-1' });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('gathers a burst into one read a second', () => {
    const { invalidate } = render();
    streams[0].send(mapEvent(5));
    streams[0].send(mapEvent(6));
    streams[0].send(mapEvent(7));
    expect(invalidate).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(MAP_REREAD_GAP_MS));
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('keeps an event during a drag for exactly one read after the pointer is up', () => {
    const { invalidate } = render();
    pointer('pointerdown');
    streams[0].send(mapEvent(5));
    streams[0].send(mapEvent(6));
    act(() => vi.advanceTimersByTime(5_000));
    expect(invalidate).not.toHaveBeenCalled();

    pointer('pointerup');
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('says when the map is deleted', () => {
    const { result } = render();
    expect(result.current.gone).toBe(false);
    streams[0].send(mapEvent(5, 'deleted'));
    expect(result.current.gone).toBe(true);
  });

  it('falls back to polling while the stream is down, and reads at once when it is back', async () => {
    const { result, invalidate } = render();
    expect(result.current.fallback).toBe(false);
    await streams[0].fail();
    expect(result.current.fallback).toBe(true);

    act(() => vi.advanceTimersByTime(1_000));
    streams[1].open();
    expect(result.current.fallback).toBe(false);
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('stops reading once the page goes', () => {
    const { invalidate, unmount } = render();
    streams[0].send(mapEvent(5));
    streams[0].send(mapEvent(6));
    unmount();
    act(() => vi.advanceTimersByTime(MAP_REREAD_GAP_MS));
    expect(invalidate).toHaveBeenCalledOnce();
  });
});
