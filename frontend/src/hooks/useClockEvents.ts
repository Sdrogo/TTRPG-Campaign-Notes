import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import i18n from '../i18n';
import { createCoalescer } from '../lib/coalesce';
import type { RoomEvent } from '../lib/roomEvents';
import type { Clock } from '../types/clock';
import { clocksRootKey } from './useClocks';
import { useRoomEvents } from './useRoomEvents';

/** At most one read of the clocks a second, however many marks arrive (spec 52 Decision 5). */
export const CLOCK_READ_GAP_MS = 1000;
/** While the stream is down, the clocks are read again this often. */
export const CLOCK_FALLBACK_MS = 30_000;
/** How long a wedge another member just marked glows (spec 61 Decision 22). */
export const MARK_GLOW_MS = 300;

const CLOCK_TOPICS = new Set(['clock', 'clock_group', 'clock_rules']);

/** The closes already toasted in this tab, by clock and revision. */
const toasted = new Set<string>();

/**
 * Live clocks (spec 61 Decision 22): a `clock`, `clock_group` or
 * `clock_rules` event on the Room stream reads the Room's clock queries
 * again, gathered into one read a second; every 30 s while the stream is
 * down. A clock another member marked glows for 300 ms (the returned ids).
 *
 * Decision 23: a clock of `clocks` (what the page shows) that closes while
 * the page is open gets one quiet toast, "«Allarme» si è chiuso"; the
 * proposer of a proposal the Master refuses gets one too (Decision 13).
 */
export function useClockEvents(
  roomId: string,
  clocks: Clock[] | undefined,
  currentUserId?: string,
): ReadonlySet<string> {
  const queryClient = useQueryClient();
  const [glowing, setGlowing] = useState<ReadonlySet<string>>(() => new Set());
  const coalescer = useRef(
    createCoalescer(
      () => void queryClient.invalidateQueries({ queryKey: clocksRootKey(roomId) }),
      CLOCK_READ_GAP_MS,
      () => false,
    ),
  );

  const glow = (id: string) => {
    setGlowing((ids) => new Set(ids).add(id));
    window.setTimeout(
      () => setGlowing((ids) => new Set([...ids].filter((other) => other !== id))),
      MARK_GLOW_MS,
    );
  };

  const onEvent = (event: RoomEvent) => {
    if (!CLOCK_TOPICS.has(event.topic)) return;
    if (event.topic === 'clock' && event.kind === 'marked' && event.id) {
      const shown = clocks?.find((clock) => clock.id === event.id);
      // The viewer's own mark is already on screen at that revision.
      if (shown && (event.revision === null || event.revision > shown.revision)) glow(event.id);
    }
    if (event.topic === 'clock' && event.kind === 'deleted') {
      // Decision 13: the proposer of a refused proposal hears of it.
      const refused = clocks?.find(
        (clock) => clock.id === event.id && clock.state === 'proposed' && clock.createdBy === currentUserId,
      );
      if (refused) {
        notifications.show({ message: i18n.t('clocks.toast.refused', { name: refused.name }), autoClose: 4000 });
      }
    }
    coalescer.current.request();
  };
  const status = useRoomEvents(roomId, onEvent, () => coalescer.current.request());

  useEffect(() => {
    const current = coalescer.current;
    return () => current.cancel();
  }, []);

  useEffect(() => {
    if (status !== 'down') return;
    const fallback = window.setInterval(
      () => void queryClient.invalidateQueries({ queryKey: clocksRootKey(roomId) }),
      CLOCK_FALLBACK_MS,
    );
    return () => window.clearInterval(fallback);
  }, [status, roomId, queryClient]);

  // The states last seen, to notice a close; the first read only records them.
  const states = useRef<Map<string, Clock['state']> | null>(null);
  useEffect(() => {
    if (!clocks) return;
    const previous = states.current;
    if (previous) {
      for (const clock of clocks) {
        const key = `${clock.id}:${clock.revision}`;
        if (clock.state === 'closed' && previous.get(clock.id) === 'open' && !toasted.has(key)) {
          // Two views of one clock on screen (a Section's blocks) toast it once.
          toasted.add(key);
          notifications.show({
            message: i18n.t('clocks.toast.closed', { name: clock.name }),
            autoClose: 4000,
          });
        }
      }
    }
    states.current = new Map(clocks.map((clock) => [clock.id, clock.state]));
  }, [clocks]);

  return glowing;
}
