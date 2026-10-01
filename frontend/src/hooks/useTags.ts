import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import type { RawTag, Tag } from '../types/tag';

/** The cache key of a Room's Tags. */
function tagsQueryKey(roomId: string) {
  return ['rooms', roomId, 'tags'] as const;
}

/** Maps a Tag from the backend's wire shape; a missing `main_position` means not a Main Tag. */
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
 * Deletes a Tag (Administrator or Master, spec 13). The backend also drops it
 * from the Main items and shrinks or removes the combinations that held it,
 * and Documents lose their link to it, so the Tags, the Main items and every
 * Documents query (list and details, which carry `tagIds`) are refetched.
 */
export function useDeleteTag(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tagId: string) => {
      await apiFetch<void>(`/rooms/${roomId}/tags/${tagId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tagsQueryKey(roomId) });
      void queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'main-items'] });
      void queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'documents'] });
    },
  });
}
