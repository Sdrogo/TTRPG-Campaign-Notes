import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { renderHookWithProviders } from '../test/utils';
import { useCreateTag, useTags } from './useTags';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  fetchMock.mockReset();
});

describe('useTags', () => {
  it("reads the Room's tags", async () => {
    fetchMock.mockResolvedValue([{ id: 'tag-1', name: 'PNG', category: 'Personaggi' }]);

    const { result } = renderHookWithProviders(() => useTags('room-1', true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags');
    expect(result.current.data).toHaveLength(1);
  });

  it('does not fetch while disabled', () => {
    renderHookWithProviders(() => useTags('room-1', false));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Tags are per Room, so two Rooms' tag lists must not share a cache entry.
  it('keys the cache by Room', async () => {
    fetchMock.mockResolvedValue([]);

    const { result, queryClient } = renderHookWithProviders(() => useTags('room-2', true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(['rooms', 'room-2', 'tags'])).toEqual([]);
    expect(queryClient.getQueryData(['rooms', 'room-1', 'tags'])).toBeUndefined();
  });
});

describe('useCreateTag', () => {
  it('posts the name with an explicit null category when none is given', async () => {
    fetchMock.mockResolvedValue({ id: 'tag-2', name: 'Luoghi', category: null });

    const { result } = renderHookWithProviders(() => useCreateTag('room-1'));
    await result.current.mutateAsync({ name: 'Luoghi' });

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags', {
      method: 'POST',
      json: { name: 'Luoghi', category: null },
    });
  });

  it('keeps a category that was given', async () => {
    fetchMock.mockResolvedValue({ id: 'tag-2', name: 'Luoghi', category: 'Mappa' });

    const { result } = renderHookWithProviders(() => useCreateTag('room-1'));
    await result.current.mutateAsync({ name: 'Luoghi', category: 'Mappa' });

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags', {
      method: 'POST',
      json: { name: 'Luoghi', category: 'Mappa' },
    });
  });

  // The mention popup creates Tags inline; the suggestion list has to show
  // the new one immediately afterwards.
  it("invalidates that Room's tag list", async () => {
    fetchMock.mockResolvedValue({ id: 'tag-2', name: 'Luoghi', category: null });
    const { result, queryClient } = renderHookWithProviders(() => useCreateTag('room-1'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync({ name: 'Luoghi' });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms', 'room-1', 'tags'] }),
    );
  });

  it('propagates a rejection from the backend', async () => {
    fetchMock.mockRejectedValue(new Error('Only the Master can create Tags'));

    const { result } = renderHookWithProviders(() => useCreateTag('room-1'));

    await expect(result.current.mutateAsync({ name: 'Luoghi' })).rejects.toThrow(
      'Only the Master can create Tags',
    );
  });
});
