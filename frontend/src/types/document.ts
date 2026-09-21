export type DocumentVisibility = 'room' | 'master' | 'private' | 'selective';

export interface DocumentImage {
  id: string;
  url: string;
}

export interface Document {
  id: string;
  roomId: string;
  name: string;
  description: string;
  visibility: DocumentVisibility;
  images: DocumentImage[];
  tagIds: string[];
  ownerIds: string[];
  selectiveUserIds: string[];
}
