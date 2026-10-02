import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { toUserIdentity } from '../lib/profile';
import { FRIENDS_QUERY_KEY } from './queryKeys';
import type { Friend, FriendCode, FriendsOverview } from '../types/friend';
import type { RawUserIdentity } from '../types/profile';

interface RawFriend extends RawUserIdentity {
  friendship_id: string;
  user_id: string;
  since: string;
}

interface RawFriendsOverview {
  friends: RawFriend[];
  incoming: RawFriend[];
  outgoing: RawFriend[];
}

interface RawFriendCode {
  code: string;
  created_at: string;
}

function toFriend(raw: RawFriend): Friend {
  return {
    ...toUserIdentity(raw),
    friendshipId: raw.friendship_id,
    userId: raw.user_id,
    since: raw.since,
  };
}

function toFriendCode(raw: RawFriendCode): FriendCode {
  return { code: raw.code, createdAt: raw.created_at };
}

/** Who a friend request goes to: a member of a shared Room, or a Friend code's owner. */
export type FriendRequestTarget =
  | { userId: string; code?: undefined }
  | { code: string; userId?: undefined };

const FRIEND_CODE_QUERY_KEY = ['friend-code'] as const;

/**
 * FR-F3: the signed-in user's Friends and pending requests. Like every query,
 * it refetches when the window regains focus: there are no real-time updates
 * (D-04).
 */
export function useFriends(enabled: boolean) {
  return useQuery<FriendsOverview>({
    queryKey: FRIENDS_QUERY_KEY,
    queryFn: async () => {
      const raw = await apiFetch<RawFriendsOverview>('/friends');
      return {
        friends: raw.friends.map(toFriend),
        incoming: raw.incoming.map(toFriend),
        outgoing: raw.outgoing.map(toFriend),
      };
    },
    enabled,
  });
}

/** Refreshes the Friends lists after any change to them. */
function useInvalidateFriends() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: FRIENDS_QUERY_KEY });
}

/**
 * FR-F1: asks someone to become Friends, either a member of a Room the user
 * shares (`userId`) or the owner of a Friend code (`code`). Resolves to the
 * request as the user's new outgoing entry.
 */
export function useSendFriendRequest() {
  const invalidate = useInvalidateFriends();
  return useMutation({
    mutationFn: async (target: FriendRequestTarget) =>
      toFriend(
        await apiFetch<RawFriend>('/friends/requests', {
          method: 'POST',
          json: target.code !== undefined ? { code: target.code } : { user_id: target.userId },
        }),
      ),
    onSuccess: invalidate,
  });
}

/** FR-F2: the recipient accepts a request, by its `friendshipId`. */
export function useAcceptFriendRequest() {
  const invalidate = useInvalidateFriends();
  return useMutation({
    mutationFn: async (friendshipId: string) =>
      toFriend(
        await apiFetch<RawFriend>(`/friends/requests/${friendshipId}/accept`, { method: 'POST' }),
      ),
    onSuccess: invalidate,
  });
}

/** FR-F2: the recipient declines a request, silently for its sender (D-27). */
export function useDeclineFriendRequest() {
  const invalidate = useInvalidateFriends();
  return useMutation({
    mutationFn: async (friendshipId: string) => {
      await apiFetch<void>(`/friends/requests/${friendshipId}/decline`, { method: 'POST' });
    },
    onSuccess: invalidate,
  });
}

/**
 * FR-F2: ends a Friendship or cancels a request the user sent, by the other
 * user's id. Silent for the other user.
 */
export function useRemoveFriend() {
  const invalidate = useInvalidateFriends();
  return useMutation({
    mutationFn: async (userId: string) => {
      await apiFetch<void>(`/friends/${userId}`, { method: 'DELETE' });
    },
    onSuccess: invalidate,
  });
}

/** FR-F4: the signed-in user's Friend code, created by the backend on first use. */
export function useFriendCode(enabled: boolean) {
  return useQuery<FriendCode>({
    queryKey: FRIEND_CODE_QUERY_KEY,
    queryFn: async () => toFriendCode(await apiFetch<RawFriendCode>('/account/friend-code')),
    enabled,
  });
}

/** FR-F4: replaces the Friend code; links built from the old one stop working. */
export function useRegenerateFriendCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      toFriendCode(await apiFetch<RawFriendCode>('/account/friend-code', { method: 'POST' })),
    onSuccess: (code) => {
      queryClient.setQueryData(FRIEND_CODE_QUERY_KEY, code);
    },
  });
}
