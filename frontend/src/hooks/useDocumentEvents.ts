import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RoomEvent } from '../lib/roomEvents';
import type { Comment } from '../types/comment';
import { documentQueryKey } from './useDocuments';
import { useRoomEvents } from './useRoomEvents';

/** While the stream is down, the Document and its Comments are read again this often. */
export const DOCUMENT_FALLBACK_MS = 30_000;
/** How long a Comment another member added or changed glows. */
export const COMMENT_GLOW_MS = 1_500;

const NOTHING: ReadonlySet<string> = new Set();

/** What each Comment looked like, to tell which ones a re-read changed. */
function stamps(comments: Comment[] | undefined): Map<string, string> {
  return new Map((comments ?? []).map((comment) => [comment.id, comment.updatedAt]));
}

/**
 * Live updates on a Document's page and pane (spec 52_3). A `comments`
 * event for it reads its Comments again, and the Document too (comment
 * images are in its gallery); a `document` event reads the Document and its
 * Comments (their visibility follows the Document's). An open edit form
 * keeps what is being typed: it holds its own copy from when it opened.
 * While the stream is down both are read every 30 s; once it is back, at
 * once.
 *
 * Returns the ids of the Comments another member just added or edited, to
 * glow for 1.5 s; the viewer's own never glow.
 */
export function useDocumentEvents(
  roomId: string,
  documentId: string,
  comments: Comment[] | undefined,
  currentUserId: string,
): ReadonlySet<string> {
  const queryClient = useQueryClient();
  const [glowing, setGlowing] = useState<ReadonlySet<string>>(NOTHING);
  // What the Comments looked like when an event asked for a re-read; null
  // when nothing is waiting.
  const before = useRef<Map<string, string> | null>(null);
  const timers = useRef(new Set<number>());

  const reread = () => {
    void queryClient.invalidateQueries({ queryKey: documentQueryKey(roomId, documentId) });
  };
  const onEvent = (event: RoomEvent) => {
    if (event.id !== documentId) return;
    if (event.topic === 'comments') before.current ??= stamps(comments);
    if (event.topic === 'comments' || event.topic === 'document') reread();
  };
  const status = useRoomEvents(roomId, onEvent, reread);

  useEffect(() => {
    if (status !== 'down') return;
    const fallback = window.setInterval(
      () => void queryClient.invalidateQueries({ queryKey: documentQueryKey(roomId, documentId) }),
      DOCUMENT_FALLBACK_MS,
    );
    return () => window.clearInterval(fallback);
  }, [status, roomId, documentId, queryClient]);

  // Once the Comments are read again, what changed glows.
  useEffect(() => {
    const previous = before.current;
    if (previous === null || comments === undefined) return;
    before.current = null;
    const changed = comments
      .filter((comment) => comment.authorId !== currentUserId && previous.get(comment.id) !== comment.updatedAt)
      .map((comment) => comment.id);
    if (changed.length === 0) return;
    setGlowing((ids) => new Set([...ids, ...changed]));
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setGlowing((ids) => new Set([...ids].filter((id) => !changed.includes(id))));
    }, COMMENT_GLOW_MS);
    timers.current.add(timer);
  }, [comments, currentUserId]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return glowing;
}
