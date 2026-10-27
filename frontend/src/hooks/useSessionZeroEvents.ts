import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../lib/apiClient';
import { isDemoMode } from '../lib/demo/demoMode';
import { readBoardEvents, type BoardEvent } from '../lib/sessionZeroEvents';
import type { SessionZero } from '../types/sessionZero';
import { sessionZeroQueryKey } from './useSessionZero';

/** How long to wait before opening the stream again, by failed attempt. */
export const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
/** While the stream is down, the board is read again this often. */
export const FALLBACK_REFRESH_MS = 30_000;
/** How long a changed post-it, column or group glows. */
export const GLOW_MS = 1_500;

function useTabVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

/**
 * Live updates on the Session 0 page (spec 46_4). While the page is mounted
 * and the tab visible it keeps the Room's stream open, and on each event
 * reads the boards again (the event says only that something changed). A
 * dropped stream is opened again after a growing pause, and meanwhile the
 * boards are read every 30 s; once it is back, they are read at once for
 * what was missed. A refusal (403, 404: no longer a member, no such Room)
 * stops it. `reset` (the Session 0 was deleted) calls `onReset`.
 *
 * Returns the ids of what other members just changed, to glow for 1.5 s.
 * An event at a revision the board already has is the viewer's own write,
 * already on screen: it doesn't glow.
 */
export function useSessionZeroEvents(roomId: string, onReset: () => void): ReadonlySet<string> {
  const queryClient = useQueryClient();
  const visible = useTabVisible();
  const [glowing, setGlowing] = useState<ReadonlySet<string>>(() => new Set());
  const onResetRef = useRef(onReset);
  const openedBefore = useRef(false);

  useEffect(() => {
    onResetRef.current = onReset;
  });

  useEffect(() => {
    if (!visible || isDemoMode()) return;
    const controller = new AbortController();
    const timers = new Set<number>();
    let fallback: number | undefined;
    let attempt = 0;

    const refresh = () => void queryClient.invalidateQueries({ queryKey: sessionZeroQueryKey(roomId) });
    const later = (run: () => void, ms: number) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        run();
      }, ms);
      timers.add(timer);
    };
    const glow = (id: string) => {
      setGlowing((ids) => new Set(ids).add(id));
      later(() => setGlowing((ids) => new Set([...ids].filter((other) => other !== id))), GLOW_MS);
    };

    const onEvent = (event: BoardEvent) => {
      const shown = queryClient.getQueryData<SessionZero>([...sessionZeroQueryKey(roomId), 'open']);
      if (event.kind === 'reset') onResetRef.current();
      else if (event.id && shown && event.revision > shown.revision) glow(event.id);
      refresh();
    };
    const onOpen = () => {
      attempt = 0;
      window.clearInterval(fallback);
      fallback = undefined;
      if (openedBefore.current) refresh();
      openedBefore.current = true;
    };
    const connect = () => {
      readBoardEvents(roomId, controller.signal, onOpen, onEvent)
        .catch((error: unknown) => error)
        .then((error) => {
          if (controller.signal.aborted) return;
          if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return;
          fallback ??= window.setInterval(refresh, FALLBACK_REFRESH_MS);
          later(connect, RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
          attempt += 1;
        });
    };
    connect();

    return () => {
      controller.abort();
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearInterval(fallback);
      setGlowing(new Set());
    };
  }, [roomId, visible, queryClient]);

  return glowing;
}
