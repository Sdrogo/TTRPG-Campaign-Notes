import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import type { Tag } from '../types/tag';

function tagsQueryKey(roomId: string) {
  return ['rooms', roomId, 'tags'] as const;
}

export function useTags(roomId: string, enabled: boolean) {
  return useQuery<Tag[]>({
    queryKey: tagsQueryKey(roomId),
    queryFn: () => apiFetch<Tag[]>(`/rooms/${roomId}/tags`),
    enabled,
  });
}

export function useCreateTag(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; category?: string | null }) =>
      apiFetch<Tag>(`/rooms/${roomId}/tags`, {
        method: 'POST',
        json: { name: input.name, category: input.category ?? null },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tagsQueryKey(roomId) });
    },
  });
}
