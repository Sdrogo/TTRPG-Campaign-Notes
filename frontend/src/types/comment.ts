import type { DocumentVisibility } from './document';
import type { PendingImage, StoredImage } from './image';

// A Post of kind Comment in a Document's main Thread. Uses the same
// visibility levels as a Document (VR-03), with the author as its Owner.
export interface Comment {
  id: string;
  documentId: string;
  authorId: string;
  body: string;
  visibility: DocumentVisibility;
  selectiveUserIds: string[];
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
  // Also shown in the Document's gallery (they're Document images too).
  images: StoredImage[];
  // Decided by the backend for the current viewer.
  canEdit: boolean;
  canDelete: boolean;
}

// The editable fields of a Comment, shared by the composer and inline edit.
export interface CommentFormValues {
  body: string;
  visibility: DocumentVisibility;
  selectiveUserIds: string[];
  // Images to upload on save, and ids of already attached ones to remove.
  newImages: PendingImage[];
  removedImageIds: string[];
}

export type CommentSortOrder = 'newest' | 'oldest' | 'author';

export interface CommentFilters {
  sort: CommentSortOrder;
  query: string;
  authorId: string | null;
  visibility: DocumentVisibility | null;
  hideDeleted: boolean;
}
