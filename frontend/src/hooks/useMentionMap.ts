import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch } from '../lib/apiClient';
import {
  toMapDetail,
  toMentionMap,
  toMentionMapPreview,
  type RawMapDetail,
  type RawMentionMap,
  type RawMentionMapPreview,
  toMentionCardsBody,
} from '../lib/maps';
import type { ChangesSave } from '../types/boardChanges';
import type { Board, MentionMap, MentionMapPreview, RelationshipMapDetail } from '../types/map';
import { documentQueryKey } from './useDocuments';
import { MAP_REFRESH_MS } from './useMaps';

function mentionMapPath(roomId: string, documentId: string) {
  return `/rooms/${roomId}/documents/${documentId}/mention-map`;
}

/**
 * Keyed under the Document, so whatever refreshes it after a save (its
 * description, a Note, a Comment, any Document of the Room) refreshes the map
 * too: the map follows the mentions (spec 36 Decision 1).
 */
export function mentionMapQueryKey(roomId: string, documentId: string) {
  return [...documentQueryKey(roomId, documentId), 'mentionMap'] as const;
}

/**
 * The Document's mention map as the viewer sees it, or null when it has none
 * (spec 36). With `refresh`, while the Room stream is down, it is read
 * again every `MAP_REFRESH_MS`, like a free map (spec 52).
 */
export function useMentionMap(roomId: string, documentId: string, refresh = false) {
  return useQuery<MentionMap | null>({
    queryKey: mentionMapQueryKey(roomId, documentId),
    refetchInterval: refresh ? MAP_REFRESH_MS : false,
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

/**
 * What a mention map at `depth` would hold for the viewer (Decision 11). Not
 * retried: the Create button waits on it, so a failure is shown at once
 * instead of after several silent attempts.
 */
export function useMentionMapPreview(roomId: string, documentId: string, depth: number, enabled: boolean) {
  return useQuery<MentionMapPreview>({
    queryKey: [...mentionMapQueryKey(roomId, documentId), 'preview', depth],
    queryFn: async () =>
      toMentionMapPreview(
        await apiFetch<RawMentionMapPreview>(`${mentionMapPath(roomId, documentId)}/preview?depth=${depth}`),
      ),
    enabled,
    retry: false,
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
 * Saves the cards a manager moved or recolored since the board the page
 * last had from the server (Decision 9, per item as in spec 43): the others
 * keep their place. The answer only refreshes the cache, like a free map's
 * board save.
 */
export function useSaveMentionCards(roomId: string, documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ changes }: ChangesSave<Board>) =>
      toMentionMap(
        await apiFetch<RawMentionMap>(`${mentionMapPath(roomId, documentId)}/cards`, {
          method: 'PUT',
          json: { cards: toMentionCardsBody(changes) },
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

/** Keyed under the Document, like its mention map, so it refreshes with it. */
function linkedMapQueryKey(roomId: string, documentId: string) {
  return [...documentQueryKey(roomId, documentId), 'linkedMap'] as const;
}

/**
 * The map linked to the Document, as the viewer sees it, or null when it has
 * none or the map is hidden from them (spec 36 Decision 15). A geographic
 * map (spec 38) comes without its content, read from `useGeoMap`.
 */
export function useLinkedMap(roomId: string, documentId: string) {
  return useQuery<RelationshipMapDetail | null>({
    queryKey: linkedMapQueryKey(roomId, documentId),
    queryFn: async () => {
      try {
        return toMapDetail(await apiFetch<RawMapDetail>(`/rooms/${roomId}/documents/${documentId}/linked-map`));
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
}

/** Takes the linked map off the Document's page; the map stays. */
export function useUnlinkMap(roomId: string, documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>(`/rooms/${roomId}/documents/${documentId}/linked-map`, { method: 'DELETE' }),
    onSuccess: () => queryClient.setQueryData(linkedMapQueryKey(roomId, documentId), null),
  });
}

/**
 * Shows an existing map the viewer manages, free or geographic, on the
 * Document's page, as it is: nothing is added to the map (spec 36 Decision
 * 15, spec 38_2).
 */
export function useLinkMap(roomId: string, documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (mapId: string) =>
      toMapDetail(
        await apiFetch<RawMapDetail>(`/rooms/${roomId}/documents/${documentId}/linked-map`, {
          method: 'PUT',
          json: { map_id: mapId },
        }),
      ),
    onSuccess: (map) => queryClient.setQueryData(linkedMapQueryKey(roomId, documentId), map),
  });
}
