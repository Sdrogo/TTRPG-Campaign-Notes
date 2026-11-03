import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { emptySettings, toClock } from '../../lib/clocks';
import { rawClock, rawGroup, rawRules } from '../clockFixtures';
import { createTestQueryClient, renderHookWithProviders } from '../utils';
import {
  clockGroupsQueryKey,
  clockRulesQueryKey,
  clocksQueryKey,
  useArchiveClock,
  useClockGroups,
  useClockHistory,
  useClockRules,
  useClocks,
  useCreateClock,
  useCreateLabel,
  useCreateMarkKind,
  useCreateTemplate,
  useDeleteClock,
  useDeleteLabel,
  useDeleteMarkKind,
  useDeleteTemplate,
  useMarkClock,
  useOpenClock,
  useReorderClocks,
  useSaveClockPolicies,
  useUndoMark,
  useUpdateClock,
  useUpdateLabel,
  useUpdateMarkKind,
} from '../../hooks/useClocks';
import { sectionsQueryKey } from '../../hooks/useLanding';
import type { Clock, ClockFormValues } from '../../types/clock';

vi.mock('../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);

function seeded(clocks = [rawClock(), rawClock({ id: 'clock-2', name: 'Fuga' })]) {
  const queryClient = createTestQueryClient();
  queryClient.setDefaultOptions({ queries: { gcTime: Infinity } });
  queryClient.setQueryData(clocksQueryKey('room-1'), clocks.map(toClock));
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  return { queryClient, invalidate };
}

function cached(queryClient: ReturnType<typeof createTestQueryClient>) {
  return queryClient.getQueryData<Clock[]>(clocksQueryKey('room-1'));
}

const values: ClockFormValues = {
  ...emptySettings(),
  name: 'Allarme',
  documentId: null,
  visibility: 'room',
  selectiveUserIds: [],
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe('the clock queries', () => {
  it('reads the clocks, the rules and the groups', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/clocks')) return [rawClock()];
      if (path.endsWith('/clock-rules')) return rawRules();
      return [rawGroup()];
    });
    const clocks = renderHookWithProviders(() => useClocks('room-1'));
    const rules = renderHookWithProviders(() => useClockRules('room-1'));
    const groups = renderHookWithProviders(() => useClockGroups('room-1'));
    await waitFor(() => expect(groups.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(clocks.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(rules.result.current.isSuccess).toBe(true));
    expect(clocks.result.current.data?.[0].name).toBe('Allarme');
    expect(rules.result.current.data?.markKinds).toHaveLength(2);
    expect(groups.result.current.data?.[0].mode).toBe('race');
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clock-groups');
  });

  it('waits while disabled', () => {
    renderHookWithProviders(() => useClocks('room-1', false));
    renderHookWithProviders(() => useClockRules('room-1', false));
    renderHookWithProviders(() => useClockGroups('room-1', false));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pages the history with the cursor the server gave', async () => {
    fetchMock
      .mockResolvedValueOnce({ entries: [], next_before: '2026-11-03T10:00:00Z' })
      .mockResolvedValueOnce({ entries: [], next_before: null });
    const { result } = renderHookWithProviders(() => useClockHistory('room-1', 'clock-1'));
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(() => result.current.fetchNextPage());
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/rooms/room-1/clocks/clock-1/history');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/rooms/room-1/clocks/clock-1/history?before=2026-11-03T10%3A00%3A00Z',
    );
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  });
});

describe('the clock writes', () => {
  it('creates a clock and refreshes the Sections for the first one', async () => {
    const { queryClient, invalidate } = seeded();
    fetchMock.mockResolvedValue(rawClock({ id: 'clock-3' }));
    const { result } = renderHookWithProviders(() => useCreateClock('room-1'), { queryClient });
    await act(() => result.current.mutateAsync(values));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clocks', expect.objectContaining({ method: 'POST' }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: sectionsQueryKey('room-1') });
  });

  it('saves an edit at its revision and puts the answer in place', async () => {
    const { queryClient } = seeded();
    fetchMock.mockResolvedValue(rawClock({ name: 'Allarme rosso', revision: 4 }));
    const { result } = renderHookWithProviders(() => useUpdateClock('room-1'), { queryClient });
    const clock = cached(queryClient)![0];
    await act(() => result.current.mutateAsync({ clock, values }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/rooms/room-1/clocks/clock-1',
      expect.objectContaining({ method: 'PATCH', json: expect.objectContaining({ base_revision: 3 }) }),
    );
    expect(cached(queryClient)!.map((c) => c.name)).toEqual(['Allarme rosso', 'Fuga']);
  });

  it('leaves an empty cache alone', async () => {
    const queryClient = createTestQueryClient();
    fetchMock.mockResolvedValue(rawClock());
    const { result } = renderHookWithProviders(() => useUpdateClock('room-1'), { queryClient });
    await act(() => result.current.mutateAsync({ clock: toClock(rawClock()), values }));
    expect(cached(queryClient)).toBeUndefined();
  });

  it.each([
    ['archives', () => useArchiveClock('room-1'), { clockId: 'clock-1', archived: true }, '/rooms/room-1/clocks/clock-1', 'PATCH'],
    ['deletes', () => useDeleteClock('room-1'), 'clock-1', '/rooms/room-1/clocks/clock-1', 'DELETE'],
    ['opens', () => useOpenClock('room-1'), 'clock-1', '/rooms/room-1/clocks/clock-1/open', 'POST'],
    ['deletes a label', () => useDeleteLabel('room-1'), 'l', '/rooms/room-1/clock-rules/labels/l', 'DELETE'],
    ['deletes a kind', () => useDeleteMarkKind('room-1'), 'k', '/rooms/room-1/clock-rules/mark-kinds/k', 'DELETE'],
    ['deletes a template', () => useDeleteTemplate('room-1'), 't', '/rooms/room-1/clock-rules/templates/t', 'DELETE'],
  ] as const)('%s and reads the clocks again', async (_name, hook, input, path, method) => {
    const { queryClient, invalidate } = seeded();
    fetchMock.mockResolvedValue(undefined);
    const { result } = renderHookWithProviders(hook as () => { mutateAsync: (i: unknown) => Promise<unknown> }, {
      queryClient,
    });
    await act(() => result.current.mutateAsync(input));
    expect(fetchMock).toHaveBeenCalledWith(path, expect.objectContaining({ method }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms', 'room-1', 'clocks'] });
  });

  it('marks with a kind and a trimmed note, and answers the mark id', async () => {
    const { queryClient, invalidate } = seeded();
    fetchMock.mockResolvedValue({ clock: rawClock({ filled: 5, revision: 4 }), mark_id: 'mark-1' });
    const { result } = renderHookWithProviders(() => useMarkClock('room-1'), { queryClient });
    let answer: { markId: string } | undefined;
    await act(async () => {
      answer = await result.current.mutateAsync({ clockId: 'clock-1', delta: 1, kindId: 'kind-1', note: '  porta ' });
    });
    expect(answer?.markId).toBe('mark-1');
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clocks/clock-1/marks', {
      method: 'POST',
      json: { delta: 1, kind_id: 'kind-1', note: 'porta' },
    });
    expect(cached(queryClient)![0].filled).toBe(5);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: clockGroupsQueryKey('room-1') });
  });

  it('sends a bare mark with no kind nor note', async () => {
    fetchMock.mockResolvedValue({ clock: rawClock(), mark_id: 'mark-1' });
    const { result } = renderHookWithProviders(() => useMarkClock('room-1'));
    await act(() => result.current.mutateAsync({ clockId: 'clock-1', delta: -1 }));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clocks/clock-1/marks', {
      method: 'POST',
      json: { delta: -1, kind_id: null, note: null },
    });
  });

  it('undoes a mark', async () => {
    const { queryClient } = seeded();
    fetchMock.mockResolvedValue({ clock: rawClock({ filled: 3 }), mark_id: 'mark-1' });
    const { result } = renderHookWithProviders(() => useUndoMark('room-1'), { queryClient });
    await act(() => result.current.mutateAsync({ clockId: 'clock-1', markId: 'mark-1' }));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clocks/clock-1/marks/mark-1/undo', { method: 'POST' });
    expect(cached(queryClient)![0].filled).toBe(3);
  });

  it('reorders at once, and leaves an empty cache empty', async () => {
    const { queryClient } = seeded();
    fetchMock.mockResolvedValue(undefined);
    const { result } = renderHookWithProviders(() => useReorderClocks('room-1'), { queryClient });
    act(() => result.current.mutate(['clock-2', 'clock-1']));
    expect(cached(queryClient)!.map((c) => c.id)).toEqual(['clock-2', 'clock-1']);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clocks-order', { method: 'PUT', json: { ids: ['clock-2', 'clock-1'] } });

    const empty = createTestQueryClient();
    const other = renderHookWithProviders(() => useReorderClocks('room-1'), { queryClient: empty });
    await act(() => other.result.current.mutateAsync(['clock-1']));
    expect(cached(empty)).toBeUndefined();
  });
});

describe('the rules writes', () => {
  it('saves the policies and stores the rules', async () => {
    const { queryClient, invalidate } = seeded();
    fetchMock.mockResolvedValue(rawRules({ open_policy: 'everyone' }));
    const { result } = renderHookWithProviders(() => useSaveClockPolicies('room-1'), { queryClient });
    await act(() => result.current.mutateAsync({ openPolicy: 'everyone', markPolicy: 'master', allowUnmark: false }));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clock-rules', {
      method: 'PUT',
      json: { open_policy: 'everyone', mark_policy: 'master', allow_unmark: false },
    });
    expect(queryClient.getQueryData<{ openPolicy: string }>(clockRulesQueryKey('room-1'))?.openPolicy).toBe('everyone');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: sectionsQueryKey('room-1') });
  });

  it('creates and edits labels and kinds with trimmed names', async () => {
    fetchMock.mockImplementation(async (path: string) =>
      path.includes('labels')
        ? { id: 'l', name: 'Rock', color: 'red', position: 0, clock_count: 0 }
        : { id: 'k', name: 'Rischio', color: 'red', who: 'everyone', position: 0 },
    );
    const createLabel = renderHookWithProviders(() => useCreateLabel('room-1'));
    const updateLabel = renderHookWithProviders(() => useUpdateLabel('room-1'));
    const createKind = renderHookWithProviders(() => useCreateMarkKind('room-1'));
    const updateKind = renderHookWithProviders(() => useUpdateMarkKind('room-1'));
    await act(() => createLabel.result.current.mutateAsync({ name: ' Rock ', color: 'red' }));
    await act(() => updateLabel.result.current.mutateAsync({ id: 'l', name: ' Pop ', color: 'blue' }));
    await act(() => createKind.result.current.mutateAsync({ name: ' Rischio ', color: 'red' }));
    await act(() => createKind.result.current.mutateAsync({ name: 'Danno', color: 'red', who: 'master' }));
    await act(() => updateKind.result.current.mutateAsync({ id: 'k', name: ' Rischio ', color: 'gold', who: 'players' }));
    expect(fetchMock.mock.calls).toEqual([
      ['/rooms/room-1/clock-rules/labels', { method: 'POST', json: { name: 'Rock', color: 'red' } }],
      ['/rooms/room-1/clock-rules/labels/l', { method: 'PATCH', json: { name: 'Pop', color: 'blue' } }],
      ['/rooms/room-1/clock-rules/mark-kinds', { method: 'POST', json: { name: 'Rischio', color: 'red', who: 'everyone' } }],
      ['/rooms/room-1/clock-rules/mark-kinds', { method: 'POST', json: { name: 'Danno', color: 'red', who: 'master' } }],
      ['/rooms/room-1/clock-rules/mark-kinds/k', { method: 'PATCH', json: { name: 'Rischio', color: 'gold', who: 'players' } }],
    ]);
  });

  it('saves a template from the settings', async () => {
    fetchMock.mockResolvedValue({});
    const { result } = renderHookWithProviders(() => useCreateTemplate('room-1'));
    await act(() => result.current.mutateAsync({ name: ' Bomba ', settings: emptySettings() }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/rooms/room-1/clock-rules/templates',
      expect.objectContaining({ method: 'POST', json: expect.objectContaining({ name: 'Bomba' }) }),
    );
  });
});
