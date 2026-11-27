import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { toGlossaryBody, toGlossaryEntry } from '../lib/glossary';
import type { GlossaryEntry, GlossaryFormValues, RawGlossaryEntry } from '../types/glossary';

/** The cache key of a Room's Glossary. */
export function glossaryQueryKey(roomId: string) {
  return ['rooms', roomId, 'glossary'] as const;
}

/** The Room's Glossary entries the viewer sees, by term (spec 79). */
export function useGlossary(roomId: string, enabled: boolean) {
  return useQuery<GlossaryEntry[]>({
    queryKey: glossaryQueryKey(roomId),
    queryFn: async () =>
      (await apiFetch<RawGlossaryEntry[]>(`/rooms/${roomId}/glossary`)).map(toGlossaryEntry),
    enabled,
    // Highlighting is an extra: a failure never blocks the page's own text.
    retry: false,
  });
}

function useReloadGlossary(roomId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: glossaryQueryKey(roomId) });
    // Search results carry entries too.
    await queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'documents', 'search'] });
  };
}

/** Defines a term (Administrator or Master). 409 for a word already defined. */
export function useCreateGlossaryEntry(roomId: string) {
  const reload = useReloadGlossary(roomId);
  return useMutation({
    mutationFn: async (values: GlossaryFormValues) => {
      const raw = await apiFetch<RawGlossaryEntry>(`/rooms/${roomId}/glossary`, {
        method: 'POST',
        json: toGlossaryBody(values),
      });
      return toGlossaryEntry(raw);
    },
    onSuccess: reload,
  });
}

/** Edits an entry. */
export function useUpdateGlossaryEntry(roomId: string) {
  const reload = useReloadGlossary(roomId);
  return useMutation({
    mutationFn: async ({ entryId, values }: { entryId: string; values: GlossaryFormValues }) => {
      const raw = await apiFetch<RawGlossaryEntry | null>(`/rooms/${roomId}/glossary/${entryId}`, {
        method: 'PATCH',
        json: toGlossaryBody(values),
      });
      return raw === null ? null : toGlossaryEntry(raw);
    },
    onSuccess: reload,
  });
}

/** Deletes an entry. */
export function useDeleteGlossaryEntry(roomId: string) {
  const reload = useReloadGlossary(roomId);
  return useMutation({
    mutationFn: async (entryId: string) => {
      await apiFetch<void>(`/rooms/${roomId}/glossary/${entryId}`, { method: 'DELETE' });
    },
    onSuccess: reload,
  });
}
