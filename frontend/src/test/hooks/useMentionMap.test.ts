import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../lib/apiClient';
import { rawMapDetail, rawMentionMap } from '../fixtures';
import { renderHookWithProviders } from '../utils';
import {
  useCopyMentionMap,
  useDeleteMentionMap,
  useMentionMap,
  useMentionMapPreview,
  useSaveMentionCards,
  useSaveMentionMap,
} from '../../hooks/useMentionMap';

vi.mock('../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);
const PATH = '/rooms/room-1/documents/doc-1/mention-map';
const KEY = ['rooms', 'room-1', 'documents', 'doc-1', 'mentionMap'];

beforeEach(() => {
  fetchMock.mockReset();
});

describe('the mention map queries', () => {
  it('reads the map under its Document', async () => {
    fetchMock.mockResolvedValue(rawMentionMap());
    const { result } = renderHookWithProviders(() => useMentionMap('room-1', 'doc-1'));
    await waitFor(() => expect(result.current.data?.cards).toHaveLength(2));
    expect(result.current.data).toMatchObject({ documentId: 'doc-1', canManage: true, groups: [] });
    expect(fetchMock).toHaveBeenCalledWith(PATH);
  });

  it('answers null when the Document has no map, and fails on other errors', async () => {
    fetchMock.mockRejectedValue(new ApiError(404, 'Nessuna mappa'));
    const { result } = renderHookWithProviders(() => useMentionMap('room-1', 'doc-1'));
    await waitFor(() => expect(result.current.data).toBeNull());

    fetchMock.mockRejectedValue(new ApiError(500, 'Rotto'));
    const failing = renderHookWithProviders(() => useMentionMap('room-1', 'doc-2'));
    await waitFor(() => expect(failing.result.current.error?.message).toBe('Rotto'));
  });

  it('previews a depth', async () => {
    fetchMock.mockResolvedValue({ documents: 3, relations: 4, documents_left_out: 1 });
    const { result } = renderHookWithProviders(() => useMentionMapPreview('room-1', 'doc-1', 2, true));
    await waitFor(() => expect(result.current.data).toEqual({ documents: 3, relations: 4, documentsLeftOut: 1 }));
    expect(fetchMock).toHaveBeenCalledWith(`${PATH}/preview?depth=2`);
  });
});

describe('the mention map mutations', () => {
  it('creates the map, or changes its depth when it exists', async () => {
    fetchMock.mockResolvedValue(rawMentionMap({ depth: 1 }));
    const created = renderHookWithProviders(() => useSaveMentionMap('room-1', 'doc-1', false));
    await created.result.current.mutateAsync(1);
    expect(fetchMock).toHaveBeenLastCalledWith(PATH, { method: 'POST', json: { depth: 1 } });
    expect(created.queryClient.getQueryData<{ depth: number }>(KEY)?.depth).toBe(1);

    const changed = renderHookWithProviders(() => useSaveMentionMap('room-1', 'doc-1', true));
    await changed.result.current.mutateAsync(2);
    expect(fetchMock).toHaveBeenLastCalledWith(PATH, { method: 'PATCH', json: { depth: 2 } });
  });

  it('deletes the map', async () => {
    fetchMock.mockResolvedValue(undefined);
    const { result, queryClient } = renderHookWithProviders(() => useDeleteMentionMap('room-1', 'doc-1'));
    await result.current.mutateAsync();
    expect(fetchMock).toHaveBeenCalledWith(PATH, { method: 'DELETE' });
    expect(queryClient.getQueryData(KEY)).toBeNull();
  });

  it('saves moved cards', async () => {
    fetchMock.mockResolvedValue(rawMentionMap());
    const { result, queryClient } = renderHookWithProviders(() => useSaveMentionCards('room-1', 'doc-1'));
    const cards = [{ document_id: 'doc-2', x: 1, y: 2, color: 'red' }];
    await result.current.mutateAsync(cards);
    expect(fetchMock).toHaveBeenCalledWith(`${PATH}/cards`, { method: 'PUT', json: { cards } });
    expect(queryClient.getQueryData(KEY)).toBeTruthy();
  });

  it('copies the map as a free map and reloads the maps', async () => {
    fetchMock.mockResolvedValue(rawMapDetail());
    const { result, queryClient } = renderHookWithProviders(() => useCopyMentionMap('room-1', 'doc-1'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const copy = await result.current.mutateAsync('Menzioni di Mira');
    expect(copy.id).toBe('map-1');
    expect(fetchMock).toHaveBeenCalledWith(`${PATH}/copy`, { method: 'POST', json: { name: 'Menzioni di Mira' } });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms', 'room-1', 'maps'], exact: true });
  });
});
