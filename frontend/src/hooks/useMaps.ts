import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { toChangesBody } from '../lib/boardChanges';
import {
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
} from '../types/map';
import type { ChangesSave } from '../types/boardChanges';

function mapsPath(roomId: string) {
  return `/rooms/${roomId}/maps`;
}

function mapsQueryKey(roomId: string) {
  return ['rooms', roomId, 'maps'] as const;
}

function mapQueryKey(roomId: string, mapId: string) {
  return ['rooms', roomId, 'maps', mapId] as const;
}

/** The Room's maps the viewer sees, last edited first (spec 28 Decision 1). */
export function useMaps(roomId: string, enabled: boolean) {
  return useQuery<RelationshipMap[]>({
    queryKey: mapsQueryKey(roomId),
    queryFn: async () => (await apiFetch<RawMap[]>(mapsPath(roomId))).map(toMap),
    enabled,
  });
}

/**
 * How often an open map is read again (spec 43_2), so everyone on it sees the
 * others' changes within a few seconds; never while the tab is hidden.
 */
export const MAP_REFRESH_MS = 5000;

/**
 * One map with its board as the viewer sees it; 404 when hidden from them.
 * With `refresh` a free map is read again every `MAP_REFRESH_MS` (spec 43_2);
 * a geographic map's content is refreshed from `.../geo` instead.
 */
export function useMap(roomId: string, mapId: string, enabled: boolean, refresh = false) {
  return useQuery<RelationshipMapDetail>({
    queryKey: mapQueryKey(roomId, mapId),
    queryFn: async () => toMapDetail(await apiFetch<RawMapDetail>(`${mapsPath(roomId)}/${mapId}`)),
    enabled,
    refetchInterval: (query) => (refresh && query.state.data?.kind === 'free' ? MAP_REFRESH_MS : false),
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
 * Saves only what the editor changed (spec 43): `PATCH .../board` lays it over
 * the stored board and answers the whole board as they now see it, other
 * editors' work included. The page keeps drawing its own copy, rebased on the
 * answer, so a save landing mid-drag doesn't move anything back.
 */
export function useSaveBoard(roomId: string, mapId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ changes, baseRevision }: ChangesSave<Board>) =>
      toMapDetail(
        await apiFetch<RawMapDetail>(`${mapsPath(roomId)}/${mapId}/board`, {
          method: 'PATCH',
          json: toChangesBody(changes, toBoardBody, baseRevision),
        }),
      ),
    onSuccess: (detail) => {
      queryClient.setQueryData(mapQueryKey(roomId, mapId), detail);
      void queryClient.invalidateQueries({ queryKey: mapsQueryKey(roomId), exact: true });
    },
  });
}
