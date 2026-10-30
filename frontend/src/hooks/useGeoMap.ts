import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { toChangesBody } from '../lib/boardChanges';
import { toGeoBody, toGeoMapDetail, type RawGeoMapDetail } from '../lib/geoMaps';
import { mapExportFileName, toImportBody, toMapImportReport, type RawMapImportReport } from '../lib/mapImport';
import { saveBlob } from '../lib/roomExport';
import type { GeoBoard, GeoMapDetail } from '../types/geoMap';
import type { MapFormValues } from '../types/map';
import type { ChangesSave } from '../types/boardChanges';
import { MAP_REFRESH_MS } from './useMaps';

function mapPath(roomId: string, mapId: string) {
  return `/rooms/${roomId}/maps/${mapId}`;
}

/** Under the map's own key, so deleting the map drops it too. */
function geoQueryKey(roomId: string, mapId: string) {
  return ['rooms', roomId, 'maps', mapId, 'geo'] as const;
}

/**
 * A geographic map with its content as the viewer sees it (spec 38 Decision
 * 6). With `refresh` (the Room stream is down) it is read again every
 * `MAP_REFRESH_MS`.
 */
export function useGeoMap(roomId: string, mapId: string, enabled: boolean, refresh = false) {
  return useQuery<GeoMapDetail>({
    queryKey: geoQueryKey(roomId, mapId),
    queryFn: async () => toGeoMapDetail(await apiFetch<RawGeoMapDetail>(`${mapPath(roomId, mapId)}/geo`)),
    enabled,
    refetchInterval: refresh ? MAP_REFRESH_MS : false,
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
 * Saves only what the editor changed on the map (spec 43), laid over the
 * stored map; the answer is the whole map as they now see it. The page keeps
 * drawing its own copy, rebased on the answer, so a save landing mid-drag
 * moves nothing back.
 */
export function useSaveGeo(roomId: string, mapId: string) {
  const store = useStoreAnswer(roomId, mapId);
  return useMutation({
    mutationFn: async ({ changes, baseRevision }: ChangesSave<GeoBoard>) =>
      toGeoMapDetail(
        await apiFetch<RawGeoMapDetail>(`${mapPath(roomId, mapId)}/geo`, {
          method: 'PATCH',
          json: toChangesBody(changes, toGeoBody, baseRevision),
        }),
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

/** Reads what importing a map file would create (spec 38_3); nothing is written. */
export function usePreviewMapImport(roomId: string) {
  return useMutation({
    mutationFn: async (map: Record<string, unknown>) =>
      toMapImportReport(
        await apiFetch<RawMapImportReport>(`/rooms/${roomId}/maps/import/preview`, {
          method: 'POST',
          json: { map },
        }),
      ),
  });
}

/** Imports a map file as a new geographic map (Decision 10); the list reloads. */
export function useImportMap(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ map, values }: { map: Record<string, unknown>; values: MapFormValues }) =>
      toGeoMapDetail(
        await apiFetch<RawGeoMapDetail>(`/rooms/${roomId}/maps/import`, {
          method: 'POST',
          json: toImportBody(map, values),
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'maps'], exact: true }),
  });
}

/**
 * Downloads the map as an import file (Decision 10): what the viewer (or the
 * member being previewed) sees of it, named `<map>-<date>.json`.
 */
export function useExportMap(roomId: string, mapId: string, mapName: string) {
  return useMutation({
    mutationFn: async () => {
      const file = await apiFetch<unknown>(`${mapPath(roomId, mapId)}/export`);
      const blob = new Blob([`${JSON.stringify(file, null, 2)}\n`], { type: 'application/json' });
      saveBlob(blob, mapExportFileName(mapName, new Date()));
    },
  });
}
