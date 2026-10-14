import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch } from '../lib/apiClient';
import {
  toMapDetail,
  toMentionMap,
  toMentionMapPreview,
  type RawMapDetail,
  type RawMentionMap,
  type RawMentionMapPreview,
} from '../lib/maps';
import type { MentionMap, MentionMapPreview } from '../types/map';
import { documentQueryKey } from './useDocuments';

function mentionMapPath(roomId: string, documentId: string) {
  return `/rooms/${roomId}/documents/${documentId}/mention-map`;
}

/**
 * Keyed under the Document, so whatever refreshes it after a save (its
 * description, a Note, a Comment, any Document of the Room) refreshes the map
 * too: the map follows the mentions (spec 36 Decision 1).
 */
function mentionMapQueryKey(roomId: string, documentId: string) {
  return [...documentQueryKey(roomId, documentId), 'mentionMap'] as const;
}

/**
 * The Document's mention map as the viewer sees it, or null when it has none
 * (spec 36).
 */
export function useMentionMap(roomId: string, documentId: string) {
  return useQuery<MentionMap | null>({
    queryKey: mentionMapQueryKey(roomId, documentId),
    queryFn: async () => {
      try {
        return toMentionMap(await apiFetch<RawMentionMap>(mentionMapPath(roomId, documentId)));
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
}

/** What a mention map at `depth` would hold for the viewer (Decision 11). */
export function useMentionMapPreview(roomId: string, documentId: string, depth: number, enabled: boolean) {
  return useQuery<MentionMapPreview>({
    queryKey: [...mentionMapQueryKey(roomId, documentId), 'preview', depth],
    queryFn: async () =>
      toMentionMapPreview(
        await apiFetch<RawMentionMapPreview>(`${mentionMapPath(roomId, documentId)}/preview?depth=${depth}`),
      ),
    enabled,
  });
}

/** Creates the mention map, or changes its depth when it exists. */
export function useSaveMentionMap(roomId: string, documentId: string, exists: boolean) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (depth: number) =>
      toMentionMap(
        await apiFetch<RawMentionMap>(mentionMapPath(roomId, documentId), {
          method: exists ? 'PATCH' : 'POST',
          json: { depth },
        }),
      ),
    onSuccess: (map) => queryClient.setQueryData(mentionMapQueryKey(roomId, documentId), map),
  });
}

/** Deletes the mention map; the Document and its mentions stay. */
export function useDeleteMentionMap(roomId: string, documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>(mentionMapPath(roomId, documentId), { method: 'DELETE' }),
    onSuccess: () => queryClient.setQueryData(mentionMapQueryKey(roomId, documentId), null),
  });
}

/**
 * Saves the cards a manager moved or recolored (Decision 9). The answer only
 * refreshes the cache, like a free map's board save.
 */
export function useSaveMentionCards(roomId: string, documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (cards: { document_id: string; x: number; y: number; color: string }[]) =>
      toMentionMap(
        await apiFetch<RawMentionMap>(`${mentionMapPath(roomId, documentId)}/cards`, {
          method: 'PUT',
          json: { cards },
        }),
      ),
    onSuccess: (map) => queryClient.setQueryData(mentionMapQueryKey(roomId, documentId), map),
  });
}

/** Saves what the manager sees of the map as a free map they can edit by hand. */
export function useCopyMentionMap(roomId: string, documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      toMapDetail(
        await apiFetch<RawMapDetail>(`${mentionMapPath(roomId, documentId)}/copy`, {
          method: 'POST',
          json: { name },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'maps'], exact: true }),
  });
}
