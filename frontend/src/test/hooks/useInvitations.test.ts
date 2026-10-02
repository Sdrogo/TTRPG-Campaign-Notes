import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { rawDirectInvitation } from '../fixtures';
import { renderHookWithProviders } from '../utils';
import {
  useCreateDirectInvitation,
  useDeclineInvitation,
  useMyInvitations,
} from '../../hooks/useInvitations';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  fetchMock.mockReset();
});

describe('useMyInvitations', () => {
  it('maps the invitation, its Room and who sent it', async () => {
    fetchMock.mockResolvedValue([rawDirectInvitation()]);

    const { result } = renderHookWithProviders(() => useMyInvitations(true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/invitations/mine');
    expect(result.current.data).toEqual([
      {
        code: 'DIRECT1',
        role: 'player',
        expiresAt: '2026-10-09T12:00:00Z',
        room: {
          id: 'room-2',
          name: 'Barovia',
          gameSystem: 'D&D 5e',
          status: 'active',
          playersCanCreateDocuments: true,
        },
        invitedBy: {
          userId: 'user-2',
          email: null,
          displayName: 'Altro',
          pronouns: null,
          bio: null,
          avatarUrl: null,
        },
      },
    ]);
  });

  it('does not fetch while disabled', () => {
    renderHookWithProviders(() => useMyInvitations(false));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useDeclineInvitation', () => {
  it('declines and refreshes the list', async () => {
    fetchMock.mockResolvedValue(undefined);
    const { result, queryClient } = renderHookWithProviders(() => useDeclineInvitation());
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync('DIRECT1');

    expect(fetchMock).toHaveBeenCalledWith('/invitations/DIRECT1/decline', { method: 'POST' });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['invitations', 'mine'] }),
    );
  });
});

describe('useCreateDirectInvitation', () => {
  it('invites a Friend with the proposed role', async () => {
    fetchMock.mockResolvedValue({
      code: 'DIRECT1',
      role: 'master',
      expires_at: null,
      invitee_user_id: 'user-2',
    });
    const { result } = renderHookWithProviders(() => useCreateDirectInvitation('room-1'));

    const invitation = await result.current.mutateAsync({ userId: 'user-2', role: 'master' });

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/invitations/direct', {
      method: 'POST',
      json: { user_id: 'user-2', role: 'master' },
    });
    expect(invitation).toEqual({ code: 'DIRECT1', role: 'master', expiresAt: null });
  });
});
