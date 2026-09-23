/** A member's role, per Room. Being an Administrator is a separate flag (`isAdmin`). */
export type RoomRole = 'master' | 'player';
/** Whether a Room is in use or archived. */
export type RoomStatus = 'active' | 'archived';

/**
 * A campaign space. `playersCanCreateDocuments` is the Master's switch for
 * Players' Document creation (D-13).
 */
export interface Room {
  id: string;
  name: string;
  gameSystem: string | null;
  status: RoomStatus;
  playersCanCreateDocuments: boolean;
}

/** One of the signed-in user's Rooms, with their role in it. */
export interface MyRoom {
  room: Room;
  role: RoomRole;
  isAdmin: boolean;
}

/** A code for joining a Room with a proposed role. `expiresAt` is an ISO timestamp. */
export interface Invitation {
  code: string;
  role: RoomRole;
  expiresAt: string | null;
}
