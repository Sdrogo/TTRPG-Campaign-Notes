import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { renderHookWithProviders } from '../utils';
import { useCreateTag, useDeleteTag, useRenameTag, useTags } from '../../hooks/useTags';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

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
    expect(result.current.data).toEqual([
      { id: 'tag-1', name: 'PNG', category: 'Personaggi', mainPosition: null },
    ]);
  });

  it('maps the backend main_position to mainPosition', async () => {
    fetchMock.mockResolvedValue([{ id: 'tag-1', name: 'PNG', category: null, main_position: 2 }]);

    const { result } = renderHookWithProviders(() => useTags('room-1', true));

    await waitFor(() => expect(result.current.data?.[0].mainPosition).toBe(2));
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
    fetchMock.mockResolvedValue({
      id: 'tag-2',
      name: 'Luoghi',
      category: null,
    });

    const { result } = renderHookWithProviders(() => useCreateTag('room-1'));
    await result.current.mutateAsync({ name: 'Luoghi' });

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags', {
      method: 'POST',
      json: { name: 'Luoghi', category: null },
    });
  });

  it('keeps a category that was given', async () => {
    fetchMock.mockResolvedValue({
      id: 'tag-2',
      name: 'Luoghi',
      category: 'Mappa',
    });

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
    fetchMock.mockResolvedValue({
      id: 'tag-2',
      name: 'Luoghi',
      category: null,
    });
    const { result, queryClient } = renderHookWithProviders(() => useCreateTag('room-1'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync({ name: 'Luoghi' });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['rooms', 'room-1', 'tags'],
      }),
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

// Spec 25c: a rename shows everywhere the name is read from the Tags cache.
describe('useRenameTag', () => {
  it('patches the name and replaces the Tag in the cached list', async () => {
    fetchMock.mockResolvedValue({ id: 'b', name: 'Bee', category: 'Type', main_position: 1 });

    const { result, queryClient } = renderHookWithProviders(() => useRenameTag('room-1'));
    queryClient.setQueryData(
      ['rooms', 'room-1', 'tags'],
      [
        { id: 'a', name: 'A', category: null, mainPosition: null },
        { id: 'b', name: 'B', category: 'Type', mainPosition: 1 },
      ],
    );
    queryClient.setQueryData(['rooms', 'room-1', 'documents'], []);
    await result.current.mutateAsync({ tagId: 'b', name: 'Bee' });

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags/b', {
      method: 'PATCH',
      json: { name: 'Bee' },
    });
    expect(queryClient.getQueryData(['rooms', 'room-1', 'tags'])).toEqual([
      { id: 'a', name: 'A', category: null, mainPosition: null },
      { id: 'b', name: 'Bee', category: 'Type', mainPosition: 1 },
    ]);
    expect(queryClient.getQueryState(['rooms', 'room-1', 'documents'])?.isInvalidated).toBe(true);
  });

  it('leaves an empty cache empty', async () => {
    fetchMock.mockResolvedValue({ id: 'b', name: 'Bee', category: null });

    const { result, queryClient } = renderHookWithProviders(() => useRenameTag('room-1'));
    await result.current.mutateAsync({ tagId: 'b', name: 'Bee' });

    expect(queryClient.getQueryData(['rooms', 'room-1', 'tags'])).toBeUndefined();
  });
});

describe('useDeleteTag', () => {
  it('deletes the Tag and refreshes what depends on it', async () => {
    fetchMock.mockResolvedValue(undefined);
    const { result, queryClient } = renderHookWithProviders(() => useDeleteTag('room-1'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync('tag-1');

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags/tag-1', { method: 'DELETE' });
    // The Main items change too (the backend shrinks combinations), and every
    // Document loses a Tag link.
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms', 'room-1', 'tags'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms', 'room-1', 'main-items'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms', 'room-1', 'documents'] });
    });
  });

  it('propagates a rejection from the backend', async () => {
    fetchMock.mockRejectedValue(new Error('Tag not found'));

    const { result } = renderHookWithProviders(() => useDeleteTag('room-1'));

    await expect(result.current.mutateAsync('tag-1')).rejects.toThrow('Tag not found');
  });
});
