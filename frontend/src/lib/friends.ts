import type { Friend, FriendsOverview } from '../types/friend';

/** The link that sends a friend request to the code's owner (`/friends/add/:code`, FR-F4). */
export function friendLink(code: string): string {
  return `${window.location.origin}/friends/add/${encodeURIComponent(code)}`;
}

/** Where a user stands with the signed-in user, for "Add as Friend" on a member. */
export type FriendStatus = 'friend' | 'incoming' | 'outgoing' | 'none';

/** `userId`'s place in the signed-in user's Friends lists. */
export function friendStatus(overview: FriendsOverview, userId: string): FriendStatus {
  const has = (list: Friend[]) => list.some((friend) => friend.userId === userId);
  if (has(overview.friends)) return 'friend';
  if (has(overview.incoming)) return 'incoming';
  if (has(overview.outgoing)) return 'outgoing';
  return 'none';
}
