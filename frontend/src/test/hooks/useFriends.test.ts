import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { rawFriend, rawFriends } from '../fixtures';
import { renderHookWithProviders } from '../utils';
import {
  useAcceptFriendRequest,
  useDeclineFriendRequest,
  useFriendCode,
  useFriends,
  useRegenerateFriendCode,
  useRemoveFriend,
  useSendFriendRequest,
} from '../../hooks/useFriends';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  fetchMock.mockReset();
});

const altro = {
  friendshipId: 'friendship-1',
  userId: 'user-2',
  since: '2026-10-01T12:00:00Z',
  email: null,
  displayName: 'Altro',
  pronouns: null,
  bio: null,
  avatarUrl: null,
};

describe('useFriends', () => {
  it('maps the three lists', async () => {
    fetchMock.mockResolvedValue(
      rawFriends({
        friends: [rawFriend()],
        incoming: [rawFriend({ friendship_id: 'friendship-2', user_id: 'user-3' })],
        outgoing: [rawFriend({ friendship_id: 'friendship-3', user_id: 'user-4' })],
      }),
    );

    const { result } = renderHookWithProviders(() => useFriends(true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/friends');
    expect(result.current.data).toEqual({
      friends: [altro],
      incoming: [{ ...altro, friendshipId: 'friendship-2', userId: 'user-3' }],
      outgoing: [{ ...altro, friendshipId: 'friendship-3', userId: 'user-4' }],
    });
  });

  it('does not fetch while disabled', () => {
    renderHookWithProviders(() => useFriends(false));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useSendFriendRequest', () => {
  it('asks a member of a shared Room by user id', async () => {
    fetchMock.mockResolvedValue(rawFriend());
    const { result, queryClient } = renderHookWithProviders(() => useSendFriendRequest());
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const sent = await result.current.mutateAsync({ userId: 'user-2' });

    expect(fetchMock).toHaveBeenCalledWith('/friends/requests', {
      method: 'POST',
      json: { user_id: 'user-2' },
    });
    expect(sent).toEqual(altro);
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['friends'] }));
  });

  it("asks a Friend code's owner by the code alone", async () => {
    fetchMock.mockResolvedValue(rawFriend());
    const { result } = renderHookWithProviders(() => useSendFriendRequest());

    await result.current.mutateAsync({ code: 'FRIEND1' });

    expect(fetchMock).toHaveBeenCalledWith('/friends/requests', {
      method: 'POST',
      json: { code: 'FRIEND1' },
    });
  });
});

describe('answering and removing', () => {
  it('accepts a request and returns the new Friend', async () => {
    fetchMock.mockResolvedValue(rawFriend());
    const { result, queryClient } = renderHookWithProviders(() => useAcceptFriendRequest());
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    expect(await result.current.mutateAsync('friendship-1')).toEqual(altro);

    expect(fetchMock).toHaveBeenCalledWith('/friends/requests/friendship-1/accept', {
      method: 'POST',
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['friends'] }));
  });

  it('declines a request', async () => {
    fetchMock.mockResolvedValue(undefined);
    const { result, queryClient } = renderHookWithProviders(() => useDeclineFriendRequest());
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync('friendship-1');

    expect(fetchMock).toHaveBeenCalledWith('/friends/requests/friendship-1/decline', {
      method: 'POST',
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['friends'] }));
  });

  it('removes a Friend or cancels a request by user id', async () => {
    fetchMock.mockResolvedValue(undefined);
    const { result, queryClient } = renderHookWithProviders(() => useRemoveFriend());
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync('user-2');

    expect(fetchMock).toHaveBeenCalledWith('/friends/user-2', { method: 'DELETE' });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['friends'] }));
  });
});

describe('Friend code', () => {
  it('reads the code', async () => {
    fetchMock.mockResolvedValue({ code: 'FRIEND1', created_at: '2026-10-01T12:00:00Z' });

    const { result } = renderHookWithProviders(() => useFriendCode(true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/account/friend-code');
    expect(result.current.data).toEqual({ code: 'FRIEND1', createdAt: '2026-10-01T12:00:00Z' });
  });

  it('does not fetch while disabled', () => {
    renderHookWithProviders(() => useFriendCode(false));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The old link stops working at once, so the page must show the new one
  // straight away rather than after a refetch.
  it('replaces the cached code when regenerated', async () => {
    fetchMock.mockResolvedValue({ code: 'FRIEND2', created_at: '2026-10-02T12:00:00Z' });
    const { result, queryClient } = renderHookWithProviders(() => useRegenerateFriendCode());

    await result.current.mutateAsync();

    expect(fetchMock).toHaveBeenCalledWith('/account/friend-code', { method: 'POST' });
    expect(queryClient.getQueryData(['friend-code'])).toEqual({
      code: 'FRIEND2',
      createdAt: '2026-10-02T12:00:00Z',
    });
  });
});
