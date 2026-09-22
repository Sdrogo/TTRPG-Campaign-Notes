import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import type { Member } from '../types/member';
import type { RoomRole } from '../types/room';

interface RawMember {
  user_id: string;
  email: string | null;
  role: RoomRole;
  is_admin: boolean;
}

function toMember(raw: RawMember): Member {
  return { userId: raw.user_id, email: raw.email, role: raw.role, isAdmin: raw.is_admin };
}

function membersQueryKey(roomId: string) {
  return ['rooms', roomId, 'members'] as const;
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
