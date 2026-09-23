import type { UserIdentity } from './profile';
import type { RoomRole } from './room';

/** A member of a Room: their role, their Administrator flag and their public profile. */
export interface Member extends UserIdentity {
  userId: string;
  role: RoomRole;
  isAdmin: boolean;
}
