export type RoomRole = 'master' | 'player';
export type RoomStatus = 'active' | 'archived';

export interface Room {
  id: string;
  name: string;
  gameSystem: string | null;
  status: RoomStatus;
  playersCanCreateDocuments: boolean;
}

export interface MyRoom {
  room: Room;
  role: RoomRole;
  isAdmin: boolean;
}

export interface Invitation {
  code: string;
  role: RoomRole;
  expiresAt: string | null;
}
