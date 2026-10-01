import type { Character } from '../types/character';

/** A Character in the snake_case shape the backend sends it. */
export interface RawCharacter {
  document_id: string;
  name: string;
  image_url: string | null;
}

/** Maps a Character from its wire shape. */
export function toCharacter(raw: RawCharacter): Character {
  return { documentId: raw.document_id, name: raw.name, imageUrl: raw.image_url };
}

function postAsKey(roomId: string) {
  return `postAs:${roomId}`;
}

/**
 * The Character last picked in the composer's "Post as" for this Room, or
 * null for yourself. A convenience only: storage can be unavailable (private
 * window, blocked site data), so every access is guarded and the composer
 * then starts as yourself.
 */
export function readLastPostAs(roomId: string): string | null {
  try {
    return localStorage.getItem(postAsKey(roomId));
  } catch {
    return null;
  }
}

/** Remembers the composer's "Post as" choice for this Room; null forgets it. */
export function saveLastPostAs(roomId: string, documentId: string | null): void {
  try {
    if (documentId === null) {
      localStorage.removeItem(postAsKey(roomId));
    } else {
      localStorage.setItem(postAsKey(roomId), documentId);
    }
  } catch {
    // Nothing to do: the next Comment starts as yourself.
  }
}
