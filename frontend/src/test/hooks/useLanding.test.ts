import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import type { RoomEvent } from '../../lib/roomEvents';
import { toSection, type RawSection } from '../../lib/landing';
import { rawBlock, rawSection, rawSections, rawSessionZeroOverview } from '../fixtures';
import { createTestQueryClient, renderHookWithProviders } from '../utils';
import {
  sectionsQueryKey,
  useCreateSection,
  useDeleteSection,
  useLandingEvents,
  useReorderSections,
  useRoomSections,
  useSaveBlocks,
  useSectionImage,
  useSectionTools,
  useUpdateSection,
} from '../../hooks/useLanding';
import { useRoomEvents } from '../../hooks/useRoomEvents';
import { useSessionZeroOverview } from '../../hooks/useSessionZero';
import type { BlockInput, LandingSection } from '../../types/landing';

vi.mock('../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../../hooks/useRoomEvents', () => ({ useRoomEvents: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);
const KEY = sectionsQueryKey('room-1');

function seeded(sections: Record<string, unknown>[] = rawSections([rawSection()])) {
  const queryClient = createTestQueryClient();
  queryClient.setDefaultOptions({ queries: { gcTime: Infinity } });
  queryClient.setQueryData(KEY, (sections as unknown as RawSection[]).map(toSection));
  return queryClient;
}

function cached(queryClient: ReturnType<typeof createTestQueryClient>) {
  return queryClient.getQueryData<LandingSection[]>(KEY)!;
}

const mapsBlock: BlockInput = { kind: 'maps', heading: null, tagIds: [], groups: [], mapKind: 'free', features: [], collapsed: false, moduleId: null };

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(useRoomEvents).mockReset();
});

describe('the landing queries', () => {
  it('reads the Sections in their camelCase shape', async () => {
    fetchMock.mockResolvedValue([rawSection({ image_url: 'http://img', blocks: [rawBlock({ groups: [['tag-1']] })] })]);
    const { result } = renderHookWithProviders(() => useRoomSections('room-1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/sections');
    expect(result.current.data).toEqual([
      {
        id: 'section-1',
        kind: 'custom',
        position: 3,
        title: 'Tokyo',
        description: '',
        imageUrl: 'http://img',
        canEdit: true,
        blocks: [
          {
            id: 'block-1',
            kind: 'documents',
            position: 0,
            heading: null,
            tagIds: ['tag-1'],
            groups: [['tag-1']],
            mapKind: null,
            features: [],
            collapsed: false,
            moduleId: null,
            toolKind: null,
            playersVisible: null,
          },
        ],
      },
    ]);
  });

  it('waits when disabled', () => {
    renderHookWithProviders(() => useRoomSections('room-1', false));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads a Section's tools, and waits when there are none (spec 60)", async () => {
    const module = { id: 'm-1', kind: 'poll', position: 0, columns: [] };
    fetchMock.mockResolvedValue({ revision: 4, tools: [{ module_id: 'm-1', players_visible: false, module }] });
    const { result } = renderHookWithProviders(() => useSectionTools('room-1', 'section-1', true));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/sections/section-1/tools');
    expect(result.current.data).toEqual({ revision: 4, tools: [{ moduleId: 'm-1', playersVisible: false, module }] });
    fetchMock.mockClear();
    renderHookWithProviders(() => useSectionTools('room-1', 'section-2', false));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the Session 0 overview', async () => {
    fetchMock.mockResolvedValue(rawSessionZeroOverview());
    const { result } = renderHookWithProviders(() => useSessionZeroOverview('room-1', true));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/session-zero/overview');
    const [round] = result.current.data!.rounds;
    expect(round.startedAt).toBe('2026-10-27T09:00:00Z');
    expect(round.steps.map((step) => step.kind)).toEqual(['retro', 'questions', 'ddi', 'poll']);
    expect(round.steps[0]).toEqual({ id: 'step-retro', kind: 'retro', position: 0, cards: 2 });
    expect(round.steps[1].questions?.questions).toHaveLength(1);
    expect(round.steps[2].ddi?.documentId).toBe('doc-1');
    expect(round.steps[3].polls?.[0].voterCount).toBe(1);
    expect(result.current.data!.linesVeils).toEqual({ must: 1, veils: 2 });
  });
});

describe('the landing events', () => {
  it('reads again what each event touches, and everything after a drop', () => {
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    renderHookWithProviders(() => useLandingEvents('room-1'), { queryClient });
    const [roomId, onEvent, onReopen] = vi.mocked(useRoomEvents).mock.calls[0];
    expect(roomId).toBe('room-1');
    const send = (topic: string) => onEvent({ revision: null, kind: 'changed', id: null, topic } as unknown as RoomEvent);
    for (const topic of ['landing', 'session_zero', 'document', 'map', 'comment']) send(topic);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      KEY,
      ['rooms', 'room-1', 'session-zero'],
      ['rooms', 'room-1', 'documents'],
      ['rooms', 'room-1', 'maps'],
    ]);
    invalidate.mockClear();
    onReopen!();
    expect(invalidate).toHaveBeenCalledTimes(4);
  });
});

describe('the landing writes', () => {
  it('creates a custom Section last, and a page card back', async () => {
    const queryClient = seeded();
    fetchMock.mockResolvedValueOnce(rawSection({ id: 'section-2', position: 4, title: 'Kyoto' }));
    const { result } = renderHookWithProviders(() => useCreateSection('room-1'), { queryClient });
    await act(() => result.current.mutateAsync({ title: 'Kyoto' }));
    expect(fetchMock).toHaveBeenLastCalledWith('/rooms/room-1/sections', {
      method: 'POST',
      json: { kind: 'custom', title: 'Kyoto' },
    });
    expect(cached(queryClient).map((section) => section.id).at(-1)).toBe('section-2');

    fetchMock.mockResolvedValueOnce(rawSection({ id: 'page-maps', kind: 'page_maps', position: 1, title: null }));
    await act(() => result.current.mutateAsync({ kind: 'page_maps' }));
    expect(fetchMock).toHaveBeenLastCalledWith('/rooms/room-1/sections', {
      method: 'POST',
      json: { kind: 'page_maps', title: null },
    });
  });

  it('leaves an empty cache alone', async () => {
    const queryClient = createTestQueryClient();
    fetchMock.mockResolvedValueOnce(rawSection());
    const { result } = renderHookWithProviders(() => useCreateSection('room-1'), { queryClient });
    await act(() => result.current.mutateAsync({ title: 'Tokyo' }));
    expect(queryClient.getQueryData(KEY)).toBeUndefined();
  });

  it('updates a Section in place', async () => {
    const queryClient = seeded();
    fetchMock.mockResolvedValueOnce(rawSection({ title: 'Osaka', description: 'Neon' }));
    const { result } = renderHookWithProviders(() => useUpdateSection('room-1'), { queryClient });
    await act(() => result.current.mutateAsync({ id: 'section-1', title: 'Osaka', description: 'Neon' }));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/sections/section-1', {
      method: 'PATCH',
      json: { title: 'Osaka', description: 'Neon' },
    });
    expect(cached(queryClient).find((section) => section.id === 'section-1')?.title).toBe('Osaka');
    expect(cached(queryClient)).toHaveLength(4);
  });

  it('deletes a Section', async () => {
    const queryClient = seeded();
    fetchMock.mockResolvedValueOnce(undefined);
    const { result } = renderHookWithProviders(() => useDeleteSection('room-1'), { queryClient });
    await act(() => result.current.mutateAsync('section-1'));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/sections/section-1', { method: 'DELETE' });
    expect(cached(queryClient).map((section) => section.id)).not.toContain('section-1');
  });

  it('reorders at once, keeps the answer, and goes back on a failure', async () => {
    const queryClient = seeded();
    const ids = ['section-1', 'page-maps', 'page-documents', 'page-session-zero', 'missing'];
    let resolve: (value: unknown) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise((done) => (resolve = done)) as never);
    const { result } = renderHookWithProviders(() => useReorderSections('room-1'), { queryClient });
    act(() => result.current.mutate(ids));
    await waitFor(() => expect(cached(queryClient)[0].id).toBe('section-1'));
    expect(cached(queryClient)).toHaveLength(4);
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/sections/order', { method: 'PUT', json: { ids } });
    await act(async () => resolve([rawSection({ position: 0 })]));
    await waitFor(() => expect(cached(queryClient)).toHaveLength(1));

    const before = cached(queryClient);
    fetchMock.mockRejectedValueOnce(new Error('no'));
    await act(() => result.current.mutateAsync(['section-1']).catch(() => undefined));
    expect(cached(queryClient)).toEqual(before);
  });

  it('reorders without a cache', async () => {
    const queryClient = createTestQueryClient();
    fetchMock.mockRejectedValueOnce(new Error('no'));
    const { result } = renderHookWithProviders(() => useReorderSections('room-1'), { queryClient });
    await act(() => result.current.mutateAsync(['a']).catch(() => undefined));
    expect(queryClient.getQueryData(KEY)).toBeUndefined();
  });

  it('saves the blocks at once with temporary ids, and goes back on a failure', async () => {
    const queryClient = seeded();
    let resolve: (value: unknown) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise((done) => (resolve = done)) as never);
    const { result } = renderHookWithProviders(() => useSaveBlocks('room-1', 'section-1'), { queryClient });
    act(() => result.current.mutate([{ ...mapsBlock, id: 'block-9' }, mapsBlock]));
    await waitFor(() =>
      expect(cached(queryClient).find((section) => section.id === 'section-1')?.blocks.map((block) => block.id)).toEqual([
        'block-9',
        'new-1',
      ]),
    );
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/sections/section-1/blocks', {
      method: 'PUT',
      json: {
        blocks: [
          { kind: 'maps', heading: null, tag_ids: [], groups: [], map_kind: 'free', features: [], module_id: null, collapsed: false },
          { kind: 'maps', heading: null, tag_ids: [], groups: [], map_kind: 'free', features: [], module_id: null, collapsed: false },
        ],
      },
    });
    await act(async () => resolve(rawSection({ blocks: [rawBlock({ id: 'block-2', kind: 'maps', tag_ids: [] })] })));
    await waitFor(() =>
      expect(cached(queryClient).find((section) => section.id === 'section-1')?.blocks.map((block) => block.id)).toEqual([
        'block-2',
      ]),
    );

    fetchMock.mockRejectedValueOnce(new Error('no'));
    await act(() => result.current.mutateAsync([]).catch(() => undefined));
    expect(cached(queryClient).find((section) => section.id === 'section-1')?.blocks).toHaveLength(1);
  });

  it('keeps a tool block its kind and visibility while saving (spec 60)', async () => {
    const tool = rawBlock({ id: 'block-7', kind: 'tool', tag_ids: [], module_id: 'm-1', tool_kind: 'retro', players_visible: true });
    const queryClient = seeded(rawSections([rawSection({ blocks: [tool] })]));
    fetchMock.mockReturnValueOnce(new Promise(() => {}) as never);
    const { result } = renderHookWithProviders(() => useSaveBlocks('room-1', 'section-1'), { queryClient });
    const [saved] = cached(queryClient).find((section) => section.id === 'section-1')!.blocks;
    act(() => result.current.mutate([{ ...saved, collapsed: true }, mapsBlock]));
    await waitFor(() =>
      expect(
        cached(queryClient)
          .find((section) => section.id === 'section-1')
          ?.blocks.map((block) => [block.toolKind, block.playersVisible, block.collapsed]),
      ).toEqual([
        ['retro', true, true],
        [null, null, false],
      ]),
    );
  });

  it('saves the blocks without a cache', async () => {
    const queryClient = createTestQueryClient();
    fetchMock.mockRejectedValueOnce(new Error('no'));
    const { result } = renderHookWithProviders(() => useSaveBlocks('room-1', 'section-1'), { queryClient });
    await act(() => result.current.mutateAsync([]).catch(() => undefined));
    expect(queryClient.getQueryData(KEY)).toBeUndefined();
  });

  it('changes the image by file, by URL, and removes it', async () => {
    const queryClient = seeded();
    const { result } = renderHookWithProviders(() => useSectionImage('room-1', 'section-1'), { queryClient });
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    fetchMock.mockResolvedValueOnce(rawSection({ image_url: 'http://one' }));
    await act(() => result.current.upload.mutateAsync(file));
    const [path, init] = fetchMock.mock.calls[0] as [string, { method: string; formData: FormData }];
    expect(path).toBe('/rooms/room-1/sections/section-1/image');
    expect(init.method).toBe('POST');
    expect(init.formData.get('file')).toBe(file);
    expect(cached(queryClient).find((section) => section.id === 'section-1')?.imageUrl).toBe('http://one');

    fetchMock.mockResolvedValueOnce(rawSection({ image_url: 'http://two' }));
    await act(() => result.current.fromUrl.mutateAsync('http://source'));
    expect(fetchMock).toHaveBeenLastCalledWith('/rooms/room-1/sections/section-1/image/from-url', {
      method: 'POST',
      json: { url: 'http://source' },
    });

    fetchMock.mockResolvedValueOnce(rawSection());
    await act(() => result.current.remove.mutateAsync());
    expect(fetchMock).toHaveBeenLastCalledWith('/rooms/room-1/sections/section-1/image', { method: 'DELETE' });
    expect(cached(queryClient).find((section) => section.id === 'section-1')?.imageUrl).toBeNull();
  });
});
