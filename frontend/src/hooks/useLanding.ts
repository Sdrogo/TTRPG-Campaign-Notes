import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { toBlockBody, toSection, type RawSection } from '../lib/landing';
import type { BoardWrite, RawModule } from '../lib/sessionZero';
import type { RoomEvent } from '../lib/roomEvents';
import type { BlockInput, LandingSection, SectionKind, ToolKind } from '../types/landing';
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
  return useQuery({ ...sectionsQuery(roomId), enabled });
}

/** The Sections' query, for a read outside a component (the back arrow checking a Section is still there). */
export function sectionsQuery(roomId: string) {
  return {
    queryKey: sectionsQueryKey(roomId),
    queryFn: async (): Promise<LandingSection[]> => (await apiFetch<RawSection[]>(sectionsPath(roomId))).map(toSection),
  };
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
        sections?.map((section) => {
          if (section.id !== sectionId) return section;
          // A tool block keeps its kind and visibility (spec 60), which the list doesn't carry.
          const tool = (moduleId: string | null) => section.blocks.find((block) => moduleId && block.moduleId === moduleId);
          return {
            ...section,
            blocks: blocks.map((block, position) => ({
              ...block,
              id: block.id ?? `new-${position}`,
              position,
              toolKind: tool(block.moduleId)?.toolKind ?? null,
              playersVisible: tool(block.moduleId)?.playersVisible ?? null,
            })),
          };
        }),
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

/** A Section's tool as `GET .../tools` sends it (spec 60): its step, drawn as the Session 0 page draws one. */
export interface SectionTool {
  moduleId: string;
  playersVisible: boolean;
  module: RawModule;
}

/** The Section's tools the viewer sees, with the Session 0's revision. */
export interface SectionTools {
  revision: number;
  tools: SectionTool[];
}

interface RawSectionTools {
  revision: number;
  tools: { module_id: string; players_visible: boolean; module: RawModule }[];
}

/** Under the Session 0 key, so every Session 0 event and write reads the tools again. */
export function sectionToolsQueryKey(roomId: string, sectionId: string) {
  return [...sessionZeroQueryKey(roomId), 'tools', sectionId] as const;
}

/** A Section's tools as the viewer sees them (spec 60 Decision 2): a Player only the shown ones. */
export function useSectionTools(roomId: string, sectionId: string, enabled: boolean) {
  return useQuery<SectionTools>({
    queryKey: sectionToolsQueryKey(roomId, sectionId),
    queryFn: async () => {
      const raw = await apiFetch<RawSectionTools>(`${sectionsPath(roomId)}/${sectionId}/tools`);
      return {
        revision: raw.revision,
        tools: raw.tools.map((tool) => ({ moduleId: tool.module_id, playersVisible: tool.players_visible, module: tool.module })),
      };
    },
    enabled,
  });
}

/** Adds a tool block last (Master, spec 60 Decision 5), hidden from the Players. */
export function useAddTool(roomId: string, sectionId: string) {
  const apply = useApplySection(roomId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (kind: ToolKind) =>
      toSection(await apiFetch<RawSection>(`${sectionsPath(roomId)}/${sectionId}/tools`, { method: 'POST', json: { kind } })),
    onSuccess: (section) => {
      apply(section);
      return queryClient.invalidateQueries({ queryKey: sectionToolsQueryKey(roomId, sectionId) });
    },
  });
}

/** Shows a tool to the Players or hides it again (Master, spec 60 Decision 4). */
export function useSetToolVisible(roomId: string, sectionId: string) {
  const apply = useApplySection(roomId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ moduleId, visible }: { moduleId: string; visible: boolean }) =>
      toSection(
        await apiFetch<RawSection>(`${sectionsPath(roomId)}/${sectionId}/tools/${moduleId}/visible`, {
          method: 'PUT',
          json: { visible },
        }),
      ),
    onSuccess: (section) => {
      apply(section);
      return queryClient.invalidateQueries({ queryKey: sectionToolsQueryKey(roomId, sectionId) });
    },
  });
}

/**
 * A write on a tool's board (votes, post-its, answers...), through the
 * Session 0 routes, which work on a tool unchanged; the tools are read again
 * after it, since its answer is the Session 0 page's.
 */
export function useToolWrite(roomId: string, sectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ path, method, json }: BoardWrite) => {
      await apiFetch(`/rooms/${roomId}/session-zero${path}`, { method, json });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: sectionToolsQueryKey(roomId, sectionId) }),
  });
}
