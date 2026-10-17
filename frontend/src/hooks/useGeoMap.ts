import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { toGeoBody, toGeoMapDetail, type RawGeoMapDetail } from '../lib/geoMaps';
import type { GeoBoard, GeoMapDetail } from '../types/geoMap';

function mapPath(roomId: string, mapId: string) {
  return `/rooms/${roomId}/maps/${mapId}`;
}

/** Under the map's own key, so deleting the map drops it too. */
function geoQueryKey(roomId: string, mapId: string) {
  return ['rooms', roomId, 'maps', mapId, 'geo'] as const;
}

/** A geographic map with its content as the viewer sees it (spec 38 Decision 6). */
export function useGeoMap(roomId: string, mapId: string, enabled: boolean) {
  return useQuery<GeoMapDetail>({
    queryKey: geoQueryKey(roomId, mapId),
    queryFn: async () => toGeoMapDetail(await apiFetch<RawGeoMapDetail>(`${mapPath(roomId, mapId)}/geo`)),
    enabled,
  });
}

/** Every change answers with the whole map: the cache takes it, the list refreshes. */
function useStoreAnswer(roomId: string, mapId: string) {
  const queryClient = useQueryClient();
  return (detail: GeoMapDetail) => {
    queryClient.setQueryData(geoQueryKey(roomId, mapId), detail);
    void queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'maps'], exact: true });
  };
}

/**
 * Saves everything the editor sees on the map (Decision 9). The page keeps
 * drawing its own copy, so a save landing mid-drag moves nothing back.
 */
export function useSaveGeo(roomId: string, mapId: string) {
  const store = useStoreAnswer(roomId, mapId);
  return useMutation({
    mutationFn: async (board: GeoBoard) =>
      toGeoMapDetail(
        await apiFetch<RawGeoMapDetail>(`${mapPath(roomId, mapId)}/geo`, { method: 'PUT', json: toGeoBody(board) }),
      ),
    onSuccess: store,
  });
}

/**
 * Changes the plane's size (Decision 9); refused (422) when an area or pin
 * would fall outside it. The page reloads the map from the answer.
 */
export function useResizePlane(roomId: string, mapId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (size: { width: number; height: number }) =>
      apiFetch<unknown>(mapPath(roomId, mapId), {
        method: 'PATCH',
        json: { plane_width: size.width, plane_height: size.height },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'maps'] }),
  });
}

/** What a background change sends: a file to upload, a URL to import, or nothing to remove it. */
export type BackgroundChange = { file: File } | { url: string } | null;

/** Replaces or removes the map's background image (Decision 2). */
export function useChangeBackground(roomId: string, mapId: string) {
  const store = useStoreAnswer(roomId, mapId);
  return useMutation({
    mutationFn: async (change: BackgroundChange) => {
      const path = `${mapPath(roomId, mapId)}/background`;
      if (change === null) return toGeoMapDetail(await apiFetch<RawGeoMapDetail>(path, { method: 'DELETE' }));
      if ('url' in change) {
        return toGeoMapDetail(
          await apiFetch<RawGeoMapDetail>(`${path}/from-url`, { method: 'POST', json: { url: change.url } }),
        );
      }
      const formData = new FormData();
      formData.append('file', change.file);
      return toGeoMapDetail(await apiFetch<RawGeoMapDetail>(path, { method: 'POST', formData }));
    },
    onSuccess: store,
  });
}
