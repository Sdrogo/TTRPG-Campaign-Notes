import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { toBlockBody, toSection, type RawSection } from '../lib/landing';
import type { RoomEvent } from '../lib/roomEvents';
import type { BlockInput, LandingSection, SectionKind } from '../types/landing';
import { documentsQueryKey } from './useDocuments';
import { useRoomEvents } from './useRoomEvents';
import { sessionZeroQueryKey } from './useSessionZero';

function sectionsPath(roomId: string) {
  return `/rooms/${roomId}/sections`;
}

/** The cache key of a Room's landing page. */
export function sectionsQueryKey(roomId: string) {
  return ['rooms', roomId, 'sections'] as const;
}

/** The Room's landing page: every Section in order, with its blocks (spec 55). */
export function useRoomSections(roomId: string, enabled = true) {
  return useQuery<LandingSection[]>({
    queryKey: sectionsQueryKey(roomId),
    queryFn: async () => (await apiFetch<RawSection[]>(sectionsPath(roomId))).map(toSection),
    enabled,
  });
}

/**
 * Live updates on the landing and its Sections (spec 55 Decision 18): a
 * `landing` event reads the Sections again; the items' own events (Session
 * 0, Documents, maps) read what the blocks list. Once the stream is back
 * after a drop, everything is read again for what was missed.
 */
export function useLandingEvents(roomId: string) {
  const queryClient = useQueryClient();
  const refresh = (key: readonly unknown[]) => void queryClient.invalidateQueries({ queryKey: key });
  const onEvent = (event: RoomEvent) => {
    if (event.topic === 'landing') refresh(sectionsQueryKey(roomId));
    else if (event.topic === 'session_zero') refresh(sessionZeroQueryKey(roomId));
    else if (event.topic === 'document') refresh(documentsQueryKey(roomId));
    else if (event.topic === 'map') refresh(['rooms', roomId, 'maps']);
  };
  const onReopen = () => {
    for (const key of [sectionsQueryKey(roomId), sessionZeroQueryKey(roomId), documentsQueryKey(roomId), ['rooms', roomId, 'maps']]) {
      refresh(key);
    }
  };
  useRoomEvents(roomId, onEvent, onReopen);
}

/** Puts a Section the server sent back into the cached landing, in its place. */
function useApplySection(roomId: string) {
  const queryClient = useQueryClient();
  return (section: LandingSection) => {
    queryClient.setQueryData<LandingSection[]>(sectionsQueryKey(roomId), (sections) => {
      if (!sections) return sections;
      const found = sections.some((other) => other.id === section.id);
      const next = found ? sections.map((other) => (other.id === section.id ? section : other)) : [...sections, section];
      return next.sort((a, b) => a.position - b.position);
    });
  };
}

/** Adds a Section last: a custom one with its title, or a page card back on the landing (Master). */
export function useCreateSection(roomId: string) {
  const apply = useApplySection(roomId);
  return useMutation({
    mutationFn: async (input: { kind?: SectionKind; title?: string }) =>
      toSection(
        await apiFetch<RawSection>(sectionsPath(roomId), {
          method: 'POST',
          json: { kind: input.kind ?? 'custom', title: input.title ?? null },
        }),
      ),
    onSuccess: apply,
  });
}

/** Renames a Section or changes its description (Master); only what is given is sent. */
export function useUpdateSection(roomId: string) {
  const apply = useApplySection(roomId);
  return useMutation({
    mutationFn: async ({ id, ...fields }: { id: string; title?: string; description?: string }) =>
      toSection(await apiFetch<RawSection>(`${sectionsPath(roomId)}/${id}`, { method: 'PATCH', json: fields })),
    onSuccess: apply,
  });
}

/** Deletes a Section (Master); the Documents page card can't be deleted (409). */
export function useDeleteSection(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch<void>(`${sectionsPath(roomId)}/${id}`, { method: 'DELETE' });
      return id;
    },
    onSuccess: (id) =>
      queryClient.setQueryData<LandingSection[]>(sectionsQueryKey(roomId), (sections) =>
        sections?.filter((section) => section.id !== id),
      ),
  });
}

/**
 * Moves the cards (Master): the new order shows at once and stays if the
 * server agrees; it goes back if the write fails.
 */
export function useReorderSections(roomId: string) {
  const queryClient = useQueryClient();
  const key = sectionsQueryKey(roomId);
  return useMutation({
    mutationFn: async (ids: string[]) =>
      (await apiFetch<RawSection[]>(`${sectionsPath(roomId)}/order`, { method: 'PUT', json: { ids } })).map(toSection),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<LandingSection[]>(key);
      if (previous) {
        const byId = new Map(previous.map((section) => [section.id, section]));
        queryClient.setQueryData(
          key,
          ids.flatMap((id, position) => {
            const section = byId.get(id);
            return section ? [{ ...section, position }] : [];
          }),
        );
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: (sections) => queryClient.setQueryData(key, sections),
  });
}

/**
 * Saves a Section's whole list of blocks (Master, spec 55 Decision 11). The
 * new list shows at once, with temporary ids for new blocks, and goes back
 * if the write fails.
 */
export function useSaveBlocks(roomId: string, sectionId: string) {
  const queryClient = useQueryClient();
  const key = sectionsQueryKey(roomId);
  const apply = useApplySection(roomId);
  return useMutation({
    mutationFn: async (blocks: (BlockInput & { id?: string })[]) =>
      toSection(
        await apiFetch<RawSection>(`${sectionsPath(roomId)}/${sectionId}/blocks`, {
          method: 'PUT',
          json: { blocks: blocks.map(toBlockBody) },
        }),
      ),
    onMutate: async (blocks) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<LandingSection[]>(key);
      queryClient.setQueryData<LandingSection[]>(key, (sections) =>
        sections?.map((section) =>
          section.id === sectionId
            ? {
                ...section,
                blocks: blocks.map((block, position) => ({ ...block, id: block.id ?? `new-${position}`, position })),
              }
            : section,
        ),
      );
      return { previous };
    },
    onError: (_error, _blocks, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: apply,
  });
}

/** Changes a Section card's image (Master): an uploaded file, a URL, or none. */
export function useSectionImage(roomId: string, sectionId: string) {
  const apply = useApplySection(roomId);
  const path = `${sectionsPath(roomId)}/${sectionId}/image`;
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return toSection(await apiFetch<RawSection>(path, { method: 'POST', formData }));
    },
    onSuccess: apply,
  });
  const fromUrl = useMutation({
    mutationFn: async (url: string) =>
      toSection(await apiFetch<RawSection>(`${path}/from-url`, { method: 'POST', json: { url } })),
    onSuccess: apply,
  });
  const remove = useMutation({
    mutationFn: async () => toSection(await apiFetch<RawSection>(path, { method: 'DELETE' })),
    onSuccess: apply,
  });
  return { upload, fromUrl, remove };
}
