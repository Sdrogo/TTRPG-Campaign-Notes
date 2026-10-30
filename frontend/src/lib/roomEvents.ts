import { apiOpenStream } from './apiClient';

/** What a Room stream event is about (spec 52 Decision 1). */
export type RoomEventTopic = 'session_zero' | 'map' | 'document' | 'comments';

/**
 * One line of the Room stream (spec 52 Decision 3): something changed, never
 * what it says. `id` is the post-it, column, map or Document touched, when
 * there is one; `revision` is the Session 0's or the map's after the write.
 */
export interface RoomEvent {
  topic: RoomEventTopic;
  revision: number | null;
  kind: string;
  id: string | null;
}

/**
 * Splits what the stream has sent so far into whole events and the part of
 * the next one still arriving. Comment lines (`: keep-alive`) carry nothing.
 */
export function parseEvents(buffer: string): { events: RoomEvent[]; rest: string } {
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop()!;
  const events = blocks.flatMap((block) =>
    block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => JSON.parse(line.slice('data:'.length)) as RoomEvent),
  );
  return { events, rest };
}

/**
 * Reads a Room's stream, calling `onOpen` once it is open and `onEvent` for
 * each event, until the server closes it (resolves) or it fails or `signal`
 * aborts it (rejects).
 */
export async function readRoomEvents(
  roomId: string,
  signal: AbortSignal,
  onOpen: () => void,
  onEvent: (event: RoomEvent) => void,
): Promise<void> {
  const response = await apiOpenStream(`/rooms/${roomId}/events`, signal);
  onOpen();
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    const parsed = parseEvents(buffer + value);
    buffer = parsed.rest;
    for (const event of parsed.events) onEvent(event);
  }
}
