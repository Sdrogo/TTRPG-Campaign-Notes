import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createCoalescer, type Coalescer } from '../lib/coalesce';
import type { RoomEvent } from '../lib/roomEvents';
import type { RelationshipMap } from '../types/map';
import { useRoomEvents } from './useRoomEvents';

/** At most one re-read of a map this often, however many events arrive (spec 52 Decision 5). */
export const MAP_REREAD_GAP_MS = 1_000;

/** Whether a pointer is down anywhere: a drag, a pan or a resize on the map. */
function usePointerHeld(onRelease: () => void) {
  const held = useRef(false);
  const release = useRef(onRelease);
  useEffect(() => {
    release.current = onRelease;
  });
  useEffect(() => {
    const press = () => {
      held.current = true;
    };
    const letGo = () => {
      held.current = false;
      release.current();
    };
    window.addEventListener('pointerdown', press, true);
    window.addEventListener('pointerup', letGo, true);
    window.addEventListener('pointercancel', letGo, true);
    return () => {
      window.removeEventListener('pointerdown', press, true);
      window.removeEventListener('pointerup', letGo, true);
      window.removeEventListener('pointercancel', letGo, true);
    };
  }, []);
  return held;
}

/**
 * Live updates on a map's page (spec 52_2), replacing the 5 s polling of
 * spec 43_2. The map is read again on an event for it at a revision it
 * doesn't have yet (an older or equal one is the viewer's own write), and on
 * any Document event (cards show Documents' names, subtitles and images, and
 * a reveal can add a card). Re-reads are gathered: at most one a second and
 * none while a pointer is down, each request kept until then. `fallback`
 * says the stream is down, so the map reads itself every `MAP_REFRESH_MS`
 * as before; `gone` says the map was deleted.
 */
export function useMapEvents(roomId: string, mapId: string): { fallback: boolean; gone: boolean } {
  const queryClient = useQueryClient();
  const [gone, setGone] = useState(false);
  const coalescer = useRef<Coalescer | null>(null);
  const held = usePointerHeld(() => coalescer.current?.release());

  useEffect(() => {
    const reread = createCoalescer(
      () => void queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'maps', mapId] }),
      MAP_REREAD_GAP_MS,
      () => held.current,
    );
    coalescer.current = reread;
    return () => {
      reread.cancel();
      coalescer.current = null;
    };
  }, [queryClient, roomId, mapId, held]);

  const known = () =>
    Math.max(
      queryClient.getQueryData<RelationshipMap>(['rooms', roomId, 'maps', mapId])?.revision ?? 0,
      queryClient.getQueryData<RelationshipMap>(['rooms', roomId, 'maps', mapId, 'geo'])?.revision ?? 0,
    );
  const onEvent = (event: RoomEvent) => {
    if (event.topic === 'map' && event.id === mapId) {
      if (event.kind === 'deleted') setGone(true);
      else if (event.revision === null || event.revision > known()) coalescer.current?.request();
    } else if (event.topic === 'document') {
      coalescer.current?.request();
    }
  };
  const status = useRoomEvents(roomId, onEvent, () => coalescer.current?.request());

  return { fallback: status === 'down', gone };
}
