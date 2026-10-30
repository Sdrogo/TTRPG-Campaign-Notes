import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRoomEvents, type RoomEvent } from '../../lib/roomEvents';
import type { Comment } from '../../types/comment';
import { createTestQueryClient, renderHookWithProviders } from '../utils';
import { COMMENT_GLOW_MS, DOCUMENT_FALLBACK_MS, useDocumentEvents } from '../../hooks/useDocumentEvents';

vi.mock('../../lib/roomEvents', () => ({ readRoomEvents: vi.fn() }));

const readMock = vi.mocked(readRoomEvents);
const DOCUMENT_KEY = ['rooms', 'room-1', 'documents', 'doc-1'];

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

function comment(id: string, authorId: string, updatedAt = '2026-10-30T10:00:00Z'): Comment {
  return { id, authorId, updatedAt } as Comment;
}

let shown: Comment[] | undefined;

function render(initial: Comment[] | undefined) {
  shown = initial;
  const queryClient = createTestQueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
  const hook = renderHookWithProviders(() => useDocumentEvents('room-1', 'doc-1', shown, 'me'), { queryClient });
  streams[0].open();
  /** The Comments as read again. */
  const rerender = ({ comments }: { comments: Comment[] | undefined }) => {
    shown = comments;
    hook.rerender();
  };
  return { ...hook, rerender, invalidate };
}

const commentsEvent: RoomEvent = { topic: 'comments', revision: null, kind: 'changed', id: 'doc-1' };

describe('useDocumentEvents (spec 52_3)', () => {
  it("reads the Document and its Comments again on their events, and on nobody else's", () => {
    const { invalidate } = render([]);
    streams[0].send({ ...commentsEvent, id: 'doc-2' });
    streams[0].send({ topic: 'map', revision: 3, kind: 'changed', id: 'doc-1' });
    expect(invalidate).not.toHaveBeenCalled();

    streams[0].send(commentsEvent);
    streams[0].send({ topic: 'document', revision: null, kind: 'changed', id: 'doc-1' });
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: DOCUMENT_KEY });
  });

  it("makes another member's new or edited Comment glow for a moment, never the viewer's own", () => {
    const old = comment('c-1', 'ana');
    const { result, rerender } = render([old]);
    streams[0].send(commentsEvent);

    rerender({
      comments: [comment('c-1', 'ana', '2026-10-30T11:00:00Z'), comment('c-2', 'ana'), comment('c-3', 'me')],
    });
    expect([...result.current]).toEqual(['c-1', 'c-2']);

    act(() => vi.advanceTimersByTime(COMMENT_GLOW_MS));
    expect(result.current.size).toBe(0);
  });

  it('makes every Comment of another member glow when they arrive before the first read', () => {
    const { result, rerender } = render(undefined);
    streams[0].send(commentsEvent);
    rerender({ comments: [comment('c-1', 'ana')] });
    expect([...result.current]).toEqual(['c-1']);
  });

  it('glows nothing for an unchanged thread, a Document event or the first read', () => {
    const { result, rerender } = render(undefined);
    rerender({ comments: [comment('c-1', 'ana')] });
    expect(result.current.size).toBe(0);

    streams[0].send(commentsEvent);
    rerender({ comments: undefined });
    rerender({ comments: [comment('c-1', 'ana')] });
    expect(result.current.size).toBe(0);

    streams[0].send({ topic: 'document', revision: null, kind: 'changed', id: 'doc-1' });
    rerender({ comments: [comment('c-1', 'ana', '2026-10-30T12:00:00Z')] });
    expect(result.current.size).toBe(0);
  });

  it('reads both every 30 s while the stream is down, and at once when it is back', async () => {
    const { invalidate } = render([]);
    await streams[0].fail();
    act(() => vi.advanceTimersByTime(DOCUMENT_FALLBACK_MS));
    expect(invalidate).toHaveBeenCalledOnce();

    act(() => vi.advanceTimersByTime(30_000 - DOCUMENT_FALLBACK_MS + 1_000));
    streams.at(-1)!.open();
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('forgets the glow when the page goes', () => {
    const { rerender, unmount } = render([]);
    streams[0].send(commentsEvent);
    rerender({ comments: [comment('c-1', 'ana')] });
    unmount();
    act(() => vi.advanceTimersByTime(COMMENT_GLOW_MS));
  });
});
