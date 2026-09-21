import type { StoredImage } from './image';

export type DocumentVisibility = 'room' | 'master' | 'private' | 'selective';

export type DocumentImage = StoredImage;

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

// The editable fields of a Document, shared by the create modal and the
// inline editor on the detail page.
export interface DocumentFormValues {
  name: string;
  description: string;
  visibility: DocumentVisibility;
  tagIds: string[];
}
