import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiOpenStream } from '../../lib/apiClient';
import { parseEvents, readBoardEvents } from '../../lib/sessionZeroEvents';

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
      ': open\n\ndata: {"revision": 2, "kind": "card", "id": "card-1"}\n\ndata: {"revis',
    );
    expect(events).toEqual([{ revision: 2, kind: 'card', id: 'card-1' }]);
    expect(rest).toBe('data: {"revis');
  });
});

describe('readBoardEvents', () => {
  it('opens the Room stream and reports each event, even split across chunks', async () => {
    openMock.mockResolvedValue(
      streaming([
        ': open\n\n',
        'data: {"revision": 3, "kind": "timer", ',
        '"id": null}\n\n: keep-alive\n\ndata: {"revision": 4, "kind": "reset", "id": null}\n\n',
      ]),
    );
    const controller = new AbortController();
    const onOpen = vi.fn();
    const onEvent = vi.fn();

    await readBoardEvents('room-1', controller.signal, onOpen, onEvent);

    expect(openMock).toHaveBeenCalledWith('/rooms/room-1/session-zero/events', controller.signal);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls).toEqual([
      [{ revision: 3, kind: 'timer', id: null }],
      [{ revision: 4, kind: 'reset', id: null }],
    ]);
  });

  it('fails when the stream cannot open', async () => {
    openMock.mockRejectedValue(new Error('offline'));
    const onOpen = vi.fn();
    await expect(readBoardEvents('room-1', new AbortController().signal, onOpen, vi.fn())).rejects.toThrow(
      'offline',
    );
    expect(onOpen).not.toHaveBeenCalled();
  });
});
