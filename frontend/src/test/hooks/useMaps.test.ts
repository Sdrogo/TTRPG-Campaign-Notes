import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { rawMap, rawMapDetail } from '../fixtures';
import { renderHookWithProviders } from '../utils';
import {
  useCreateMap,
  useDeleteMap,
  useMap,
  useMaps,
  useSaveBoard,
  useUpdateMap,
} from '../../hooks/useMaps';
import type { MapFormValues } from '../../types/map';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);
const LIST_KEY = ['rooms', 'room-1', 'maps'];
const DETAIL_KEY = ['rooms', 'room-1', 'maps', 'map-1'];

const form: MapFormValues = {
  name: 'La Corte',
  description: '',
  visibility: 'selective',
  selectiveUserIds: ['user-2'],
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe('the map queries', () => {
  it('lists the maps', async () => {
    fetchMock.mockResolvedValue([rawMap()]);
    const { result } = renderHookWithProviders(() => useMaps('room-1', true));
    await waitFor(() => expect(result.current.data?.[0].name).toBe('La Corte'));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps');
  });

  it('reads one map with its board', async () => {
    fetchMock.mockResolvedValue(rawMapDetail());
    const { result } = renderHookWithProviders(() => useMap('room-1', 'map-1', true));
    await waitFor(() => expect(result.current.data?.cards).toHaveLength(3));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps/map-1');
  });
});

describe('the map mutations', () => {
  it('creates a map and reloads the list', async () => {
    fetchMock.mockResolvedValue(rawMapDetail());
    const { result, queryClient } = renderHookWithProviders(() => useCreateMap('room-1'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const created = await result.current.mutateAsync(form);

    expect(created.id).toBe('map-1');
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps', {
      method: 'POST',
      json: { name: 'La Corte', description: '', visibility: 'selective', selective_user_ids: ['user-2'] },
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: LIST_KEY }));
  });

  it('updates a map into the cache', async () => {
    fetchMock.mockResolvedValue(rawMapDetail({ name: 'Nuova' }));
    const { result, queryClient } = renderHookWithProviders(() => useUpdateMap('room-1', 'map-1'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync(form);

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps/map-1', expect.objectContaining({ method: 'PATCH' }));
    expect(queryClient.getQueryData<{ name: string }>(DETAIL_KEY)?.name).toBe('Nuova');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: LIST_KEY, exact: true });
  });

  it('deletes a map and drops it from the cache', async () => {
    fetchMock.mockResolvedValue(undefined);
    const { result, queryClient } = renderHookWithProviders(() => useDeleteMap('room-1', 'map-1'));
    queryClient.setQueryData(DETAIL_KEY, { id: 'map-1' });

    await result.current.mutateAsync();

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps/map-1', { method: 'DELETE' });
    expect(queryClient.getQueryData(DETAIL_KEY)).toBeUndefined();
  });

  it('saves the board and refreshes the map and the list', async () => {
    fetchMock.mockResolvedValue(rawMapDetail());
    const { result, queryClient } = renderHookWithProviders(() => useSaveBoard('room-1', 'map-1'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync({ groups: [], cards: [], arrows: [] });

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps/map-1/board', {
      method: 'PUT',
      json: { groups: [], cards: [], arrows: [] },
    });
    expect(queryClient.getQueryData(DETAIL_KEY)).toBeDefined();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: LIST_KEY, exact: true });
  });
});
