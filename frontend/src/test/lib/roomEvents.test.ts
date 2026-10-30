import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiOpenStream } from '../../lib/apiClient';
import { parseEvents, readRoomEvents } from '../../lib/roomEvents';

vi.mock('../../lib/apiClient', () => ({ apiOpenStream: vi.fn() }));

const openMock = vi.mocked(apiOpenStream);

/** A stream response that sends `chunks` one by one, then closes. */
function streaming(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(new TextEncoder().encode(chunk)));
      controller.close();
    },
  });
  return new Response(body);
}

beforeEach(() => {
  openMock.mockReset();
});

describe('parseEvents', () => {
  it('reads whole events, skips comments and keeps the part still arriving', () => {
    const { events, rest } = parseEvents(
      ': open\n\ndata: {"topic": "session_zero", "revision": 2, "kind": "card", "id": "card-1"}\n\ndata: {"revis',
    );
    expect(events).toEqual([{ topic: 'session_zero', revision: 2, kind: 'card', id: 'card-1' }]);
    expect(rest).toBe('data: {"revis');
  });
});

describe('readRoomEvents', () => {
  it('opens the Room stream and reports each event, even split across chunks', async () => {
    openMock.mockResolvedValue(
      streaming([
        ': open\n\n',
        'data: {"topic": "session_zero", "revision": 3, "kind": "timer", ',
        '"id": null}\n\n: keep-alive\n\ndata: {"topic": "map", "revision": 4, "kind": "deleted", "id": "map-1"}\n\n',
      ]),
    );
    const controller = new AbortController();
    const onOpen = vi.fn();
    const onEvent = vi.fn();

    await readRoomEvents('room-1', controller.signal, onOpen, onEvent);

    expect(openMock).toHaveBeenCalledWith('/rooms/room-1/events', controller.signal);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls).toEqual([
      [{ topic: 'session_zero', revision: 3, kind: 'timer', id: null }],
      [{ topic: 'map', revision: 4, kind: 'deleted', id: 'map-1' }],
    ]);
  });

  it('fails when the stream cannot open', async () => {
    openMock.mockRejectedValue(new Error('offline'));
    const onOpen = vi.fn();
    await expect(readRoomEvents('room-1', new AbortController().signal, onOpen, vi.fn())).rejects.toThrow(
      'offline',
    );
    expect(onOpen).not.toHaveBeenCalled();
  });
});
