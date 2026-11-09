import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { toMapDetail, type RawMapDetail } from '../lib/maps';
import type { ColorMeanings, LegendPreset } from '../types/map';

interface RawPreset {
  id: string;
  name: string;
  entries: ColorMeanings;
  map_count: number;
}

function presetsPath(roomId: string) {
  return `/rooms/${roomId}/map-legend-presets`;
}

function presetsQueryKey(roomId: string) {
  return ['rooms', roomId, 'map-legend-presets'] as const;
}

function toPreset(raw: RawPreset): LegendPreset {
  return { id: raw.id, name: raw.name, entries: raw.entries, mapCount: raw.map_count };
}

/** What a map's legend becomes: linked to a Room preset, or its own meanings (spec 68). */
export type LegendChange = { presetId: string } | { meanings: ColorMeanings };

/**
 * Sets a map's legend (spec 68 Decisions 10, 21, 22) through `PATCH .../board`
 * with nothing but `legend`, so the board itself is untouched; the map's
 * cached detail takes the answer.
 */
export function useSaveLegend(roomId: string, mapId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (change: LegendChange) =>
      toMapDetail(
        await apiFetch<RawMapDetail>(`/rooms/${roomId}/maps/${mapId}/board`, {
          method: 'PATCH',
          json: {
            legend: 'presetId' in change ? { preset_id: change.presetId } : { meanings: change.meanings },
          },
        }),
      ),
    onSuccess: (detail) => {
      queryClient.setQueryData(['rooms', roomId, 'maps', mapId], detail);
      // A preset's count of linked maps changed.
      return queryClient.invalidateQueries({ queryKey: presetsQueryKey(roomId) });
    },
  });
}

/** The Room's presets, by name (Decision 25: any member reads them). */
export function useLegendPresets(roomId: string, enabled: boolean) {
  return useQuery<LegendPreset[]>({
    queryKey: presetsQueryKey(roomId),
    queryFn: async () => (await apiFetch<RawPreset[]>(presetsPath(roomId))).map(toPreset),
    enabled,
  });
}

/**
 * What changes a preset: its list, and every open map, since linked maps
 * show its meanings live (Decision 20).
 */
function useRefreshAfterPreset(roomId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: presetsQueryKey(roomId) }),
      queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'maps'] }),
    ]);
}

/** The Master saves a new preset (Decision 23). */
export function useCreatePreset(roomId: string) {
  const refresh = useRefreshAfterPreset(roomId);
  return useMutation({
    mutationFn: async (preset: { name: string; entries: ColorMeanings }) =>
      toPreset(await apiFetch<RawPreset>(presetsPath(roomId), { method: 'POST', json: preset })),
    onSuccess: refresh,
  });
}

/** The Master renames a preset or changes its meanings, for every linked map at once. */
export function useUpdatePreset(roomId: string) {
  const refresh = useRefreshAfterPreset(roomId);
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; name?: string; entries?: ColorMeanings }) =>
      toPreset(
        await apiFetch<RawPreset>(`${presetsPath(roomId)}/${id}`, { method: 'PATCH', json: patch }),
      ),
    onSuccess: refresh,
  });
}

/** The Master deletes a preset; linked maps keep a copy of its meanings. */
export function useDeletePreset(roomId: string) {
  const refresh = useRefreshAfterPreset(roomId);
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`${presetsPath(roomId)}/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
}
