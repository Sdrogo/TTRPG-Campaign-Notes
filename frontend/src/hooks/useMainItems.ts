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
 * Replaces the Room's Main items (Administrator only). Spec 25c saves on every
 * change, so the new list goes into the cache before the request (optimistic)
 * and comes back out if it fails, with the server's list refetched. The
 * requests share a scope, so they run one at a time in the order they were
 * made and the last list on screen is the last one saved. The Tags' own
 * `mainPosition` changes too, so that list is refetched after a save.
 */
export function useSetMainItems(roomId: string) {
  const queryClient = useQueryClient();
  const queryKey = mainItemsQueryKey(roomId);
  return useMutation({
    scope: { id: `main-items-${roomId}` },
    mutationFn: async (items: MainItem[]) =>
      (
        await apiFetch<RawMainItem[]>(`/rooms/${roomId}/tags/main`, {
          method: 'PUT',
          json: { items: items.map((item) => ({ tag_ids: item.tagIds })) },
        })
      ).map(toMainItem),
    onMutate: async (items) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<MainItem[]>(queryKey);
      queryClient.setQueryData(queryKey, items);
      return { previous };
    },
    onError: (_error, _items, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
      void queryClient.invalidateQueries({ queryKey });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['rooms', roomId, 'tags'],
      });
    },
  });
}
