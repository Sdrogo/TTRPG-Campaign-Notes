import type { UserIdentity } from './profile';
import type { RoomRole } from './room';

export interface Member extends UserIdentity {
  userId: string;
  role: RoomRole;
  isAdmin: boolean;
}
