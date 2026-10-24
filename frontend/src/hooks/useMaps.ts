import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import {
  isStaleBoard,
  toBoardBody,
  toMap,
  toMapBody,
  toMapDetail,
  type RawMap,
  type RawMapDetail,
} from '../lib/maps';
import type {
  Board,
  MapFormValues,
  RelationshipMap,
  RelationshipMapDetail,
  RevisionedSave,
} from '../types/map';

function mapsPath(roomId: string) {
  return `/rooms/${roomId}/maps`;
}

function mapsQueryKey(roomId: string) {
  return ['rooms', roomId, 'maps'] as const;
}

function mapQueryKey(roomId: string, mapId: string) {
  return ['rooms', roomId, 'maps', mapId] as const;
}

/**
 * After a board save refused as stale (spec 42 Decision 7), reloads the map
 * (its geographic content too, under the same key) so the page can take it.
 */
export function useReloadIfStale(roomId: string, mapId: string) {
  const queryClient = useQueryClient();
  return (error: Error) => {
    if (isStaleBoard(error)) void queryClient.invalidateQueries({ queryKey: mapQueryKey(roomId, mapId) });
  };
}

/** The Room's maps the viewer sees, last edited first (spec 28 Decision 1). */
export function useMaps(roomId: string, enabled: boolean) {
  return useQuery<RelationshipMap[]>({
    queryKey: mapsQueryKey(roomId),
    queryFn: async () => (await apiFetch<RawMap[]>(mapsPath(roomId))).map(toMap),
    enabled,
  });
}

/** One map with its board as the viewer sees it; 404 when hidden from them. */
export function useMap(roomId: string, mapId: string, enabled: boolean) {
  return useQuery<RelationshipMapDetail>({
    queryKey: mapQueryKey(roomId, mapId),
    queryFn: async () => toMapDetail(await apiFetch<RawMapDetail>(`${mapsPath(roomId)}/${mapId}`)),
    enabled,
  });
}

/** Creates an empty map; the list reloads. */
export function useCreateMap(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: MapFormValues) =>
      toMapDetail(
        await apiFetch<RawMapDetail>(mapsPath(roomId), { method: 'POST', json: toMapBody(values) }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mapsQueryKey(roomId) }),
  });
}

/** Renames a map or changes who sees it. */
export function useUpdateMap(roomId: string, mapId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: MapFormValues) =>
      toMapDetail(
        await apiFetch<RawMapDetail>(`${mapsPath(roomId)}/${mapId}`, {
          method: 'PATCH',
          json: toMapBody(values),
        }),
      ),
    onSuccess: (detail) => {
      queryClient.setQueryData(mapQueryKey(roomId, mapId), detail);
      // A geographic map's page reads its revision from `.../geo` (spec 42 Decision 7).
      void queryClient.invalidateQueries({ queryKey: [...mapQueryKey(roomId, mapId), 'geo'] });
      return queryClient.invalidateQueries({ queryKey: mapsQueryKey(roomId), exact: true });
    },
  });
}

/** Deletes a map with everything on it. */
export function useDeleteMap(roomId: string, mapId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>(`${mapsPath(roomId)}/${mapId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: mapQueryKey(roomId, mapId) });
      return queryClient.invalidateQueries({ queryKey: mapsQueryKey(roomId), exact: true });
    },
  });
}

/**
 * Saves the whole board the editor sees (Decision 12), refused (412) when
 * someone else saved since `baseRevision` (spec 42), which reloads the map.
 * The answer only refreshes the cache: the page keeps drawing its own copy,
 * so a save landing mid-drag doesn't move anything back.
 */
export function useSaveBoard(roomId: string, mapId: string) {
  const queryClient = useQueryClient();
  const reloadIfStale = useReloadIfStale(roomId, mapId);
  return useMutation({
    mutationFn: async ({ value, baseRevision }: RevisionedSave<Board>) =>
      toMapDetail(
        await apiFetch<RawMapDetail>(`${mapsPath(roomId)}/${mapId}/board`, {
          method: 'PUT',
          json: toBoardBody(value, baseRevision),
        }),
      ),
    onError: reloadIfStale,
    onSuccess: (detail) => {
      queryClient.setQueryData(mapQueryKey(roomId, mapId), detail);
      void queryClient.invalidateQueries({ queryKey: mapsQueryKey(roomId), exact: true });
    },
  });
}
