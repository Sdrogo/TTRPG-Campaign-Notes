import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import type { MainItem } from '../types/tag';

interface RawMainItem {
  tag_ids: string[];
}

/** Maps a Main item from the backend's wire shape. */
function toMainItem(raw: RawMainItem): MainItem {
  return { tagIds: raw.tag_ids };
}

/** The cache key of a Room's Main items. */
function mainItemsQueryKey(roomId: string) {
  return ['rooms', roomId, 'main-items'] as const;
}

/**
 * The Room's Main items in their chosen order (specs 11, 11_2), for any
 * member: the Documents list groups by them.
 */
export function useMainItems(roomId: string, enabled: boolean) {
  return useQuery<MainItem[]>({
    queryKey: mainItemsQueryKey(roomId),
    queryFn: async () =>
      (await apiFetch<RawMainItem[]>(`/rooms/${roomId}/tags/main`)).map(toMainItem),
    enabled,
  });
}

/**
 * Replaces the Room's Main items (Administrator only). The answer is the
 * saved list, stored in the cache; the Tags' own `mainPosition` changed too,
 * so that list is refetched.
 */
export function useSetMainItems(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (items: MainItem[]) =>
      (
        await apiFetch<RawMainItem[]>(`/rooms/${roomId}/tags/main`, {
          method: 'PUT',
          json: { items: items.map((item) => ({ tag_ids: item.tagIds })) },
        })
      ).map(toMainItem),
    onSuccess: (items) => {
      queryClient.setQueryData(mainItemsQueryKey(roomId), items);
      void queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'tags'] });
    },
  });
}
