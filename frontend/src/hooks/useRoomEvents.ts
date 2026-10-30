import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/apiClient';
import { isDemoMode } from '../lib/demo/demoMode';
import { readRoomEvents, type RoomEvent } from '../lib/roomEvents';

/** How long to wait before opening the stream again, by failed attempt. */
export const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/**
 * Where a Room's stream stands for the page: `off` (none, as in the Demo),
 * `connecting`, `open`, `down` (dropped, opening again: read on a fallback
 * interval meanwhile), `paused` (the tab is hidden) or `refused` (403/404:
 * no longer a member, no such Room; never opened again).
 */
export type RoomStreamStatus = 'off' | 'connecting' | 'open' | 'down' | 'paused' | 'refused';

interface Listener {
  onEvent: (event: RoomEvent) => void;
  /** The stream is open again after a drop or a hidden tab: read what was missed. */
  onReopen: () => void;
}

/** One Room's stream, shared by every listener of the tab (spec 52 Decision 1). */
class RoomStream {
  readonly listeners = new Set<Listener>();
  readonly watchers = new Set<() => void>();
  status: RoomStreamStatus = 'connecting';
  private controller: AbortController | undefined;
  private retry: number | undefined;
  private attempt = 0;
  private openedBefore = false;
  private readonly roomId: string;

  constructor(roomId: string) {
    this.roomId = roomId;
  }

  begin() {
    document.addEventListener('visibilitychange', this.onVisibility);
    this.onVisibility();
  }

  end() {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.stop();
  }

  private readonly onVisibility = () => {
    if (this.status === 'refused') return;
    if (document.visibilityState !== 'visible') {
      this.stop();
      this.setStatus('paused');
    } else if (!this.controller) {
      this.attempt = 0;
      this.setStatus('connecting');
      this.connect();
    }
  };

  private setStatus(status: RoomStreamStatus) {
    if (status === this.status) return;
    this.status = status;
    this.watchers.forEach((watch) => watch());
  }

  private stop() {
    this.controller?.abort();
    this.controller = undefined;
    window.clearTimeout(this.retry);
    this.retry = undefined;
  }

  private connect() {
    const controller = new AbortController();
    this.controller = controller;
    const onOpen = () => {
      this.attempt = 0;
      this.setStatus('open');
      if (this.openedBefore) [...this.listeners].forEach((listener) => listener.onReopen());
      this.openedBefore = true;
    };
    const onEvent = (event: RoomEvent) => [...this.listeners].forEach((listener) => listener.onEvent(event));
    readRoomEvents(this.roomId, controller.signal, onOpen, onEvent)
      .catch((error: unknown) => error)
      .then((error) => {
        if (controller.signal.aborted) return;
        this.controller = undefined;
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          this.setStatus('refused');
          return;
        }
        this.setStatus('down');
        const delay = RETRY_DELAYS_MS[Math.min(this.attempt, RETRY_DELAYS_MS.length - 1)];
        this.attempt += 1;
        this.retry = window.setTimeout(() => {
          this.retry = undefined;
          this.connect();
        }, delay);
      });
  }
}

const streams = new Map<string, RoomStream>();

function join(roomId: string, listener: Listener): RoomStream {
  let stream = streams.get(roomId);
  if (!stream) {
    stream = new RoomStream(roomId);
    streams.set(roomId, stream);
    stream.begin();
  }
  stream.listeners.add(listener);
  return stream;
}

function leave(roomId: string, stream: RoomStream, listener: Listener) {
  stream.listeners.delete(listener);
  if (stream.listeners.size > 0) return;
  stream.end();
  streams.delete(roomId);
}

/**
 * Listens to the Room stream (spec 52): one stream per Room per tab, opened
 * by its first listener and closed with its last, while the tab is visible,
 * never in the Demo. `onEvent` hears every event the viewer may hear of
 * (each listener picks its own); `onReopen` runs when the stream is back
 * after a drop or a hidden tab. A dropped stream reopens after 1 to 30 s.
 * Returns the stream's status, for the listener's own fallback reads.
 */
export function useRoomEvents(
  roomId: string,
  onEvent: (event: RoomEvent) => void,
  onReopen: () => void,
): RoomStreamStatus {
  const handlers = useRef({ onEvent, onReopen });
  const [status, setStatus] = useState<RoomStreamStatus>('off');

  useEffect(() => {
    handlers.current = { onEvent, onReopen };
  });

  useEffect(() => {
    if (isDemoMode()) return;
    const listener: Listener = {
      onEvent: (event) => handlers.current.onEvent(event),
      onReopen: () => handlers.current.onReopen(),
    };
    const stream = join(roomId, listener);
    const watch = () => setStatus(stream.status);
    stream.watchers.add(watch);
    watch();
    return () => {
      stream.watchers.delete(watch);
      leave(roomId, stream, listener);
      setStatus('off');
    };
  }, [roomId]);

  return status;
}
