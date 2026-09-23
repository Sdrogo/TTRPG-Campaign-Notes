import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import type { Invitation, MyRoom, Room, RoomRole, RoomStatus } from '../types/room';

interface RawRoom {
  id: string;
  name: string;
  game_system: string | null;
  status: RoomStatus;
  players_can_create_documents: boolean;
}

interface RawMyRoom {
  room: RawRoom;
  role: RoomRole;
  is_admin: boolean;
}

interface RawInvitation {
  code: string;
  role: RoomRole;
  expires_at: string | null;
}

function toRoom(raw: RawRoom): Room {
  return {
    id: raw.id,
    name: raw.name,
    gameSystem: raw.game_system,
    status: raw.status,
    playersCanCreateDocuments: raw.players_can_create_documents,
  };
}

function toMyRoom(raw: RawMyRoom): MyRoom {
  return { room: toRoom(raw.room), role: raw.role, isAdmin: raw.is_admin };
}

function toInvitation(raw: RawInvitation): Invitation {
  return { code: raw.code, role: raw.role, expiresAt: raw.expires_at };
}

const ROOMS_QUERY_KEY = ['rooms'] as const;

/** The Rooms the signed-in user belongs to, with their role in each. */
export function useMyRooms(enabled: boolean) {
  return useQuery<MyRoom[]>({
    queryKey: ROOMS_QUERY_KEY,
    queryFn: async () => (await apiFetch<RawMyRoom[]>('/rooms')).map(toMyRoom),
    enabled,
  });
}

/** Creates a Room; the user becomes its Master and Administrator. */
export function useCreateRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; gameSystem?: string }) =>
      toRoom(
        await apiFetch<RawRoom>('/rooms', {
          method: 'POST',
          json: { name: input.name, game_system: input.gameSystem || null },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ROOMS_QUERY_KEY });
    },
  });
}

/** One Room, for its members. */
export function useRoom(roomId: string, enabled: boolean) {
  return useQuery<Room>({
    queryKey: ['rooms', roomId],
    queryFn: async () => toRoom(await apiFetch<RawRoom>(`/rooms/${roomId}`)),
    enabled,
  });
}

/** The Master switches Players' Document creation on or off (D-13). */
export function useUpdateRoomSettings(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (playersCanCreateDocuments: boolean) =>
      toRoom(
        await apiFetch<RawRoom>(`/rooms/${roomId}`, {
          method: 'PATCH',
          json: { players_can_create_documents: playersCanCreateDocuments },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rooms', roomId] });
      void queryClient.invalidateQueries({ queryKey: ROOMS_QUERY_KEY });
    },
  });
}

/** Creates an invitation code for the Room with the given role (Administrators only). */
export function useCreateInvitation(roomId: string) {
  return useMutation({
    mutationFn: async (role: RoomRole) =>
      toInvitation(
        await apiFetch<RawInvitation>(`/rooms/${roomId}/invitations`, {
          method: 'POST',
          json: { role },
        }),
      ),
  });
}

/** Joins the Room an invitation code points to, with its proposed role. */
export function useAcceptInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) =>
      toRoom(await apiFetch<RawRoom>(`/invitations/${code}/accept`, { method: 'POST' })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ROOMS_QUERY_KEY });
    },
  });
}
