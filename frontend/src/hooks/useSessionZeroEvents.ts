import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RoomEvent } from '../lib/roomEvents';
import type { SessionZero } from '../types/sessionZero';
import { useRoomEvents } from './useRoomEvents';
import { sessionZeroQueryKey } from './useSessionZero';

export { RETRY_DELAYS_MS } from './useRoomEvents';
/** While the stream is down, the board is read again this often. */
export const FALLBACK_REFRESH_MS = 30_000;
/** How long a changed post-it, column or group glows. */
export const GLOW_MS = 1_500;

const NOTHING: ReadonlySet<string> = new Set();

/**
 * Live updates on the Session 0 page (spec 46_4), on the Room stream's
 * `session_zero` topic (spec 52): each event reads the boards again (the
 * event says only that something changed). While the stream is down the
 * boards are read every 30 s; once it is back, at once for what was missed.
 * `reset` (the Session 0 was deleted) calls `onReset`.
 *
 * Returns the ids of what other members just changed, to glow for 1.5 s.
 * An event at a revision the board already has is the viewer's own write,
 * already on screen: it doesn't glow.
 */
export function useSessionZeroEvents(roomId: string, onReset: () => void): ReadonlySet<string> {
  const queryClient = useQueryClient();
  const [glowing, setGlowing] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Set<number>());

  const refresh = () => void queryClient.invalidateQueries({ queryKey: sessionZeroQueryKey(roomId) });
  const glow = (id: string) => {
    setGlowing((ids) => new Set(ids).add(id));
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setGlowing((ids) => new Set([...ids].filter((other) => other !== id)));
    }, GLOW_MS);
    timers.current.add(timer);
  };

  const onEvent = (event: RoomEvent) => {
    if (event.topic !== 'session_zero') return;
    const shown = queryClient.getQueryData<SessionZero>([...sessionZeroQueryKey(roomId), 'open']);
    if (event.kind === 'reset') onReset();
    else if (event.id && shown && event.revision !== null && event.revision > shown.revision) glow(event.id);
    refresh();
  };
  const status = useRoomEvents(roomId, onEvent, refresh);

  useEffect(() => {
    if (status !== 'down') return;
    const fallback = window.setInterval(
      () => void queryClient.invalidateQueries({ queryKey: sessionZeroQueryKey(roomId) }),
      FALLBACK_REFRESH_MS,
    );
    return () => window.clearInterval(fallback);
  }, [status, roomId, queryClient]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  // Nothing glows while the tab is hidden.
  const live = status === 'connecting' || status === 'open' || status === 'down';
  return live ? glowing : NOTHING;
}
