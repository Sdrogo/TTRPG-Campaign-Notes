export type DocumentVisibility = 'room' | 'master' | 'private' | 'selective';

export interface Document {
  id: string;
  roomId: string;
  name: string;
  description: string;
  visibility: DocumentVisibility;
  tagIds: string[];
  ownerIds: string[];
  selectiveUserIds: string[];
}
