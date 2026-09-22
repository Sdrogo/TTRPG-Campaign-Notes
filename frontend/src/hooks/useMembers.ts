import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { toUserIdentity } from '../lib/profile';
import type { Member } from '../types/member';
import type { RawUserIdentity } from '../types/profile';
import type { RoomRole } from '../types/room';

interface RawMember extends RawUserIdentity {
  user_id: string;
  role: RoomRole;
  is_admin: boolean;
}

function toMember(raw: RawMember): Member {
  return {
    ...toUserIdentity(raw),
    userId: raw.user_id,
    role: raw.role,
    isAdmin: raw.is_admin,
  };
}

function membersQueryKey(roomId: string) {
  return ['rooms', roomId, 'members'] as const;
}

// Every Room's member list names users by their profile, so a profile
// change must refresh all of them.
export function isMembersQueryKey(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'rooms' && queryKey[2] === 'members';
}

export function useMembers(roomId: string, enabled: boolean) {
  return useQuery<Member[]>({
    queryKey: membersQueryKey(roomId),
    queryFn: async () => (await apiFetch<RawMember[]>(`/rooms/${roomId}/members`)).map(toMember),
    enabled,
  });
}

export function useUpdateMember(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; role?: RoomRole; isAdmin?: boolean }) =>
      toMember(
        await apiFetch<RawMember>(`/rooms/${roomId}/members/${input.userId}`, {
          method: 'PATCH',
          json: { role: input.role, is_admin: input.isAdmin },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: membersQueryKey(roomId) });
    },
  });
}

export function useRemoveMember(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      await apiFetch<void>(`/rooms/${roomId}/members/${userId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: membersQueryKey(roomId) });
      void queryClient.invalidateQueries({ queryKey: ['rooms'] });
    },
  });
}
