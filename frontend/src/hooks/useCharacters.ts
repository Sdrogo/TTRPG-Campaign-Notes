import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { toCharacter, type RawCharacter } from '../lib/characters';
import type { Character } from '../types/character';

/** The cache key of the caller's Characters; changing a Document's player reloads it. */
export function charactersQueryKey(roomId: string) {
  return ['rooms', roomId, 'characters', 'mine'] as const;
}

/**
 * The Characters the caller may write a Comment as (D-24), by name: the
 * Documents they play, or every Document of the Room for the Master. Empty
 * when there are none, and the composer then hides its "Post as" picker.
 */
export function useMyCharacters(roomId: string, enabled: boolean) {
  return useQuery<Character[]>({
    queryKey: charactersQueryKey(roomId),
    queryFn: async () =>
      (await apiFetch<RawCharacter[]>(`/rooms/${roomId}/characters/mine`)).map(toCharacter),
    enabled,
  });
}
