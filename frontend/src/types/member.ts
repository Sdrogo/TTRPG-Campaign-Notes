import type { RoomRole } from './room';

export interface Member {
  userId: string;
  email: string | null;
  role: RoomRole;
  isAdmin: boolean;
}
