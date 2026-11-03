import { act } from '@testing-library/react';
import { notifications } from '@mantine/notifications';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toClock } from '../../lib/clocks';
import type { RoomEvent } from '../../lib/roomEvents';
import { rawClock } from '../clockFixtures';
import { createTestQueryClient, renderHookWithProviders } from '../utils';
import {
  CLOCK_FALLBACK_MS,
  CLOCK_READ_GAP_MS,
  MARK_GLOW_MS,
  useClockEvents,
} from '../../hooks/useClockEvents';
import { useRoomEvents, type RoomStreamStatus } from '../../hooks/useRoomEvents';
import type { Clock } from '../../types/clock';

vi.mock('../../hooks/useRoomEvents', () => ({ useRoomEvents: vi.fn() }));
vi.mock('@mantine/notifications', async (original) => {
  const actual = await original<typeof import('@mantine/notifications')>();
  return { ...actual, notifications: { ...actual.notifications, show: vi.fn() } };
});

const roomEvents = vi.mocked(useRoomEvents);
const ROOT = { queryKey: ['rooms', 'room-1', 'clocks'] };

let onEvent: (event: RoomEvent) => void;
let onReopen: () => void;
let status: RoomStreamStatus;
let list: Clock[] | undefined;

function render(clocks: Clock[] | undefined = [toClock(rawClock())]) {
  const queryClient = createTestQueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
  list = clocks;
  const hook = renderHookWithProviders(() => useClockEvents('room-1', list), { queryClient });
  const rerender = (next: Clock[] | undefined) => {
    list = next;
    hook.rerender();
  };
  return { ...hook, rerender, invalidate };
}

function send(event: Partial<RoomEvent>) {
  act(() => onEvent({ topic: 'clock', revision: null, kind: 'changed', id: 'clock-1', ...event }));
}

beforeEach(() => {
  vi.useFakeTimers();
  status = 'open';
  roomEvents.mockReset();
  roomEvents.mockImplementation((_roomId, handler, reopen) => {
    onEvent = handler;
    onReopen = reopen!;
    return status;
  });
  vi.mocked(notifications.show).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useClockEvents', () => {
  it('reads the clocks again once a second, however many events arrive, and on reopen', () => {
    const { invalidate } = render();
    send({ topic: 'clock' });
    send({ topic: 'clock_group' });
    send({ topic: 'clock_rules' });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith(ROOT);
    act(() => vi.advanceTimersByTime(CLOCK_READ_GAP_MS));
    expect(invalidate).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(CLOCK_READ_GAP_MS));
    act(() => onReopen());
    expect(invalidate).toHaveBeenCalledTimes(3);
  });

  it('ignores the topics of other tools', () => {
    const { invalidate } = render();
    send({ topic: 'map' });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("glows a clock another member marked, not the viewer's own mark", () => {
    const { result } = render();
    send({ kind: 'marked', revision: 3 });
    expect(result.current.size).toBe(0);
    send({ kind: 'marked', revision: 4 });
    expect([...result.current]).toEqual(['clock-1']);
    act(() => vi.advanceTimersByTime(MARK_GLOW_MS));
    expect(result.current.size).toBe(0);
    send({ kind: 'marked', revision: null });
    expect(result.current.size).toBe(1);
  });

  it('does not glow a clock the page does not show, nor an event without an id', () => {
    const { result } = render([]);
    send({ kind: 'marked', revision: 9 });
    send({ kind: 'marked', revision: 9, id: null });
    expect(result.current.size).toBe(0);
  });

  it('reads the clocks every 30 s while the stream is down', () => {
    status = 'down';
    const { invalidate, unmount } = render();
    act(() => vi.advanceTimersByTime(CLOCK_FALLBACK_MS));
    expect(invalidate).toHaveBeenCalledWith(ROOT);
    unmount();
    invalidate.mockClear();
    act(() => vi.advanceTimersByTime(CLOCK_FALLBACK_MS));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('toasts a clock that closes while the page is open, not one already closed', () => {
    const open = toClock(rawClock());
    const { rerender } = render([open, toClock(rawClock({ id: 'clock-2', state: 'closed' }))]);
    expect(notifications.show).not.toHaveBeenCalled();
    rerender([{ ...open, state: 'closed' }, toClock(rawClock({ id: 'clock-2', state: 'closed' }))]);
    expect(notifications.show).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifications.show).mock.calls[0][0].message).toBe('«Allarme» si è chiuso');
    rerender(undefined);
    expect(notifications.show).toHaveBeenCalledTimes(1);
  });
});
