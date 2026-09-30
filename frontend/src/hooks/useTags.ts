import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import type { RawTag, Tag } from '../types/tag';

function tagsQueryKey(roomId: string) {
  return ['rooms', roomId, 'tags'] as const;
}

function toTag(raw: RawTag): Tag {
  return {
    id: raw.id,
    name: raw.name,
    category: raw.category,
    mainPosition: raw.main_position ?? null,
  };
}

/** The Room's Tags. */
export function useTags(roomId: string, enabled: boolean) {
  return useQuery<Tag[]>({
    queryKey: tagsQueryKey(roomId),
    queryFn: async () => (await apiFetch<RawTag[]>(`/rooms/${roomId}/tags`)).map(toTag),
    enabled,
  });
}

/** Adds a Tag to the Room (Administrator or Master). The backend rejects a duplicate name. */
export function useCreateTag(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; category?: string | null }) =>
      toTag(
        await apiFetch<RawTag>(`/rooms/${roomId}/tags`, {
          method: 'POST',
          json: { name: input.name, category: input.category ?? null },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tagsQueryKey(roomId) });
    },
  });
}

/**
 * Replaces the Room's Main Tags with `tagIds`, in that order (Administrator
 * only, spec 11). The answer is every Tag of the Room, so the cached list is
 * updated in place rather than refetched.
 */
export function useSetMainTags(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tagIds: string[]) =>
      (
        await apiFetch<RawTag[]>(`/rooms/${roomId}/tags/main`, {
          method: 'PUT',
          json: { tag_ids: tagIds },
        })
      ).map(toTag),
    onSuccess: (tags) => {
      queryClient.setQueryData(tagsQueryKey(roomId), tags);
    },
  });
}
