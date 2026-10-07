import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { renderHookWithProviders } from '../utils';
import { useMainItems, useSetMainItems } from '../../hooks/useMainItems';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  fetchMock.mockReset();
});

describe('useMainItems', () => {
  it("reads the Room's Main items, singles and combinations", async () => {
    fetchMock.mockResolvedValue([{ tag_ids: ['a'] }, { tag_ids: ['b', 'c'] }]);

    const { result } = renderHookWithProviders(() => useMainItems('room-1', true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags/main');
    expect(result.current.data).toEqual([{ tagIds: ['a'] }, { tagIds: ['b', 'c'] }]);
  });

  it('does not fetch while disabled', () => {
    renderHookWithProviders(() => useMainItems('room-1', false));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// Specs 11, 11_2: the Administrator's ordered list replaces the Room's items.
describe('useSetMainItems', () => {
  it('puts the ordered items and stores the saved list in the cache', async () => {
    fetchMock.mockResolvedValue([{ tag_ids: ['b', 'c'] }, { tag_ids: ['a'] }]);

    const { result, queryClient } = renderHookWithProviders(() => useSetMainItems('room-1'));
    await result.current.mutateAsync([{ tagIds: ['b', 'c'] }, { tagIds: ['a'] }]);

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags/main', {
      method: 'PUT',
      json: { items: [{ tag_ids: ['b', 'c'] }, { tag_ids: ['a'] }] },
    });
    expect(queryClient.getQueryData(['rooms', 'room-1', 'main-items'])).toEqual([
      { tagIds: ['b', 'c'] },
      { tagIds: ['a'] },
    ]);
  });

  // The singles' own `mainPosition` changed too, so the Tags list must reload.
  it("refreshes the Room's Tags", async () => {
    fetchMock.mockResolvedValue([]);

    const { result, queryClient } = renderHookWithProviders(() => useSetMainItems('room-1'));
    queryClient.setQueryData(['rooms', 'room-1', 'tags'], []);
    await result.current.mutateAsync([]);

    expect(queryClient.getQueryState(['rooms', 'room-1', 'tags'])?.isInvalidated).toBe(true);
  });

  // Spec 25c: every change saves at once, so the list shows it before the answer.
  it('shows the new list before the backend answers', async () => {
    let answer: (value: unknown) => void = () => {};
    fetchMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));

    // A disabled reader keeps the cached list alive, as the setup page does.
    const { result, queryClient } = renderHookWithProviders(() => ({
      save: useSetMainItems('room-1'),
      list: useMainItems('room-1', false),
    }));
    queryClient.setQueryData(['rooms', 'room-1', 'main-items'], [{ tagIds: ['a'] }]);
    result.current.save.mutate([{ tagIds: ['b'] }]);

    await waitFor(() => expect(result.current.list.data).toEqual([{ tagIds: ['b'] }]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    answer([{ tag_ids: ['b'] }]);
    await waitFor(() => expect(result.current.save.isSuccess).toBe(true));
  });

  it('puts the previous list back when the save fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('no')).mockResolvedValue([{ tag_ids: ['a'] }]);

    const { result, queryClient } = renderHookWithProviders(() => useSetMainItems('room-1'));
    queryClient.setQueryData(['rooms', 'room-1', 'main-items'], [{ tagIds: ['a'] }]);
    await expect(result.current.mutateAsync([{ tagIds: ['b'] }])).rejects.toThrow('no');

    expect(queryClient.getQueryData(['rooms', 'room-1', 'main-items'])).toEqual([
      { tagIds: ['a'] },
    ]);
  });

  // One save at a time, in order, so the last list on screen is the last saved.
  it('sends quick successive saves one after the other', async () => {
    const answers: ((value: unknown) => void)[] = [];
    fetchMock.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));

    const { result } = renderHookWithProviders(() => useSetMainItems('room-1'));
    result.current.mutate([{ tagIds: ['a'] }]);
    result.current.mutate([{ tagIds: ['b'] }]);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    answers[0]([{ tag_ids: ['a'] }]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith('/rooms/room-1/tags/main', {
      method: 'PUT',
      json: { items: [{ tag_ids: ['b'] }] },
    });
    answers[1]([{ tag_ids: ['b'] }]);
  });
});
