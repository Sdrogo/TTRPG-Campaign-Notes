import { apiOpenStream } from './apiClient';

/**
 * One line of the Session 0 stream (spec 46_2): something changed, never what
 * it says. `id` is the post-it, column or group touched, when there is one.
 */
export interface BoardEvent {
  revision: number;
  kind: string;
  id: string | null;
}

/**
 * Splits what the stream has sent so far into whole events and the part of
 * the next one still arriving. Comment lines (`: keep-alive`) carry nothing.
 */
export function parseEvents(buffer: string): { events: BoardEvent[]; rest: string } {
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop()!;
  const events = blocks.flatMap((block) =>
    block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => JSON.parse(line.slice('data:'.length)) as BoardEvent),
  );
  return { events, rest };
}

/**
 * Reads a Room's Session 0 stream, calling `onOpen` once it is open and
 * `onEvent` for each event, until the server closes it (resolves) or it fails
 * or `signal` aborts it (rejects).
 */
export async function readBoardEvents(
  roomId: string,
  signal: AbortSignal,
  onOpen: () => void,
  onEvent: (event: BoardEvent) => void,
): Promise<void> {
  const response = await apiOpenStream(`/rooms/${roomId}/session-zero/events`, signal);
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
