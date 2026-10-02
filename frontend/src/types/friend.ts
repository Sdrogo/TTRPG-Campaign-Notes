import type { UserIdentity } from './profile';
import type { Room, RoomRole } from './room';

/**
 * The other user of a Friendship or request, as the signed-in user sees them
 * (backend `FriendResponse`). `email` is null unless the two share a Room.
 * `since` is when the Friendship was accepted, or when the request was sent.
 */
export interface Friend extends UserIdentity {
  friendshipId: string;
  userId: string;
  since: string;
}

/**
 * FR-F3: the signed-in user's Friends, the requests they received (to accept
 * or decline) and the ones they sent (to cancel). Declining is silent (D-27),
 * so a declined request still shows in `outgoing`.
 */
export interface FriendsOverview {
  friends: Friend[];
  incoming: Friend[];
  outgoing: Friend[];
}

/** The signed-in user's Friend code (FR-F4), shared inside a link. */
export interface FriendCode {
  code: string;
  createdAt: string;
}

/** Who sent a direct Room invitation. */
export interface InvitationSender extends UserIdentity {
  userId: string;
}

/**
 * A Room invitation addressed to the signed-in user by a Friend (FR-F5),
 * waiting for them to accept or decline it.
 */
export interface DirectInvitation {
  code: string;
  role: RoomRole;
  expiresAt: string | null;
  room: Room;
  invitedBy: InvitationSender;
}
