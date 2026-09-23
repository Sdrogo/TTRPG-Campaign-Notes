import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { rawMember } from '../test/fixtures';
import { renderHookWithProviders } from '../test/utils';
import { isMembersQueryKey, useMembers, useRemoveMember, useUpdateMember } from './useMembers';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  fetchMock.mockReset();
});

describe('useMembers', () => {
  it('maps the member and its profile fields', async () => {
    fetchMock.mockResolvedValue([rawMember()]);

    const { result } = renderHookWithProviders(() => useMembers('room-1', true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/members');
    expect(result.current.data?.[0]).toEqual({
      userId: 'user-1',
      role: 'player',
      isAdmin: false,
      email: 'giocatore@example.com',
      displayName: 'Giocatore',
      pronouns: 'lui',
      bio: null,
      avatarUrl: null,
    });
  });

  it('keeps null profile fields null rather than inventing defaults', async () => {
    fetchMock.mockResolvedValue([
      rawMember({ display_name: null, email: null, pronouns: null, avatar_url: null }),
    ]);

    const { result } = renderHookWithProviders(() => useMembers('room-1', true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].displayName).toBeNull();
    expect(result.current.data?.[0].email).toBeNull();
  });

  it('does not fetch while disabled', () => {
    renderHookWithProviders(() => useMembers('room-1', false));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// Used by the Account page to refresh every Room's member list after a
// profile change, without knowing which Rooms the user is in.
describe('isMembersQueryKey', () => {
  it('matches any Room\'s members key', () => {
    expect(isMembersQueryKey(['rooms', 'room-1', 'members'])).toBe(true);
    expect(isMembersQueryKey(['rooms', 'room-2', 'members'])).toBe(true);
  });

  it('does not match other keys under the same Room', () => {
    expect(isMembersQueryKey(['rooms', 'room-1', 'documents'])).toBe(false);
    expect(isMembersQueryKey(['rooms', 'room-1', 'tags'])).toBe(false);
    expect(isMembersQueryKey(['rooms'])).toBe(false);
    expect(isMembersQueryKey(['account'])).toBe(false);
  });
});

describe('useUpdateMember', () => {
  it('patches role and admin flag in snake_case', async () => {
    fetchMock.mockResolvedValue(rawMember({ role: 'master', is_admin: true }));

    const { result } = renderHookWithProviders(() => useUpdateMember('room-1'));
    const member = await result.current.mutateAsync({
      userId: 'user-1',
      role: 'master',
      isAdmin: true,
    });

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/members/user-1', {
      method: 'PATCH',
      json: { role: 'master', is_admin: true },
    });
    expect(member.isAdmin).toBe(true);
  });

  // The backend treats an absent field as "leave it alone", so a role-only
  // change must not send `is_admin: false` and strip the admin flag.
  it('omits the field that was not being changed', async () => {
    fetchMock.mockResolvedValue(rawMember());

    const { result } = renderHookWithProviders(() => useUpdateMember('room-1'));
    await result.current.mutateAsync({ userId: 'user-1', role: 'player' });

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/members/user-1', {
      method: 'PATCH',
      json: { role: 'player', is_admin: undefined },
    });
  });

  it('invalidates the member list', async () => {
    fetchMock.mockResolvedValue(rawMember());
    const { result, queryClient } = renderHookWithProviders(() => useUpdateMember('room-1'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync({ userId: 'user-1', role: 'player' });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms', 'room-1', 'members'] }),
    );
  });

  it('propagates a last-Master conflict', async () => {
    fetchMock.mockRejectedValue(new Error('A Room must keep at least one Master'));

    const { result } = renderHookWithProviders(() => useUpdateMember('room-1'));

    await expect(
      result.current.mutateAsync({ userId: 'user-1', role: 'player' }),
    ).rejects.toThrow('A Room must keep at least one Master');
  });
});

describe('useRemoveMember', () => {
  it('deletes the membership', async () => {
    fetchMock.mockResolvedValue(undefined);

    const { result } = renderHookWithProviders(() => useRemoveMember('room-1'));
    await result.current.mutateAsync('user-2');

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/members/user-2', { method: 'DELETE' });
  });

  // Removing yourself is "leave the Room", which drops it off your own list -
  // so the rooms list has to be refreshed as well as the members list.
  it('invalidates both the member list and the rooms list', async () => {
    fetchMock.mockResolvedValue(undefined);
    const { result, queryClient } = renderHookWithProviders(() => useRemoveMember('room-1'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync('user-2');

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms', 'room-1', 'members'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms'] });
    });
  });
});
