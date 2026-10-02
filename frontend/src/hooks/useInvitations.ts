import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { toUserIdentity } from '../lib/profile';
import { toRoom, type RawRoom } from './useRooms';
import { MY_INVITATIONS_QUERY_KEY } from './queryKeys';
import type { DirectInvitation } from '../types/friend';
import type { RawUserIdentity } from '../types/profile';
import type { Invitation, RoomRole } from '../types/room';

interface RawDirectInvitation {
  code: string;
  role: RoomRole;
  expires_at: string | null;
  room: RawRoom;
  invited_by: RawUserIdentity & { user_id: string };
}

interface RawInvitation {
  code: string;
  role: RoomRole;
  expires_at: string | null;
}

function toDirectInvitation(raw: RawDirectInvitation): DirectInvitation {
  return {
    code: raw.code,
    role: raw.role,
    expiresAt: raw.expires_at,
    room: toRoom(raw.room),
    invitedBy: { ...toUserIdentity(raw.invited_by), userId: raw.invited_by.user_id },
  };
}

/**
 * FR-F5: Room invitations a Friend addressed to the signed-in user, waiting
 * for an answer. Refetched when the window regains focus (D-04: no real-time
 * updates).
 */
export function useMyInvitations(enabled: boolean) {
  return useQuery<DirectInvitation[]>({
    queryKey: MY_INVITATIONS_QUERY_KEY,
    queryFn: async () =>
      (await apiFetch<RawDirectInvitation[]>('/invitations/mine')).map(toDirectInvitation),
    enabled,
  });
}

/** The invitee declines a direct invitation, silently for its sender. */
export function useDeclineInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      await apiFetch<void>(`/invitations/${code}/decline`, { method: 'POST' });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MY_INVITATIONS_QUERY_KEY });
    },
  });
}

/**
 * FR-F5: an Administrator invites a Friend to the Room with a proposed role.
 * The Friend joins only after accepting; a new invitation replaces the open
 * one for the same Friend.
 */
export function useCreateDirectInvitation(roomId: string) {
  return useMutation({
    mutationFn: async (input: { userId: string; role: RoomRole }): Promise<Invitation> => {
      const raw = await apiFetch<RawInvitation>(`/rooms/${roomId}/invitations/direct`, {
        method: 'POST',
        json: { user_id: input.userId, role: input.role },
      });
      return { code: raw.code, role: raw.role, expiresAt: raw.expires_at };
    },
  });
}
