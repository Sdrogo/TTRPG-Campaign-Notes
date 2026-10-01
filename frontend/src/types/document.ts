import type { StoredImage } from './image';
import type { DocumentFile } from './documentFile';
import type { Note } from './note';

/**
 * Who can see a Document or a Comment (section 8 of requirements.md): `room`
 * every member, `master` the Master only, `private` Owners + Master,
 * `selective` Owners + Master + an explicit list of users.
 */
export type DocumentVisibility = 'room' | 'master' | 'private' | 'selective';

/** A Document's gallery image, in the same shape as every other image. */
export type DocumentImage = StoredImage;

/**
 * A Document as the backend returns it, already filtered for the viewer:
 * `images` leaves out Comment attachments they can't read, favorite first. The
 * Master's implicit Ownership is not in `ownerIds`.
 */
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
  /**
   * The Notes the viewer may see, in display order. Only the single-Document
   * routes send them: on a Document from the list this is always empty.
   */
  notes: Note[];
  /**
   * The PDFs attached to the Document (spec 16), oldest first. Like `notes`,
   * only the single-Document routes send them.
   */
  files: DocumentFile[];
}

/**
 * The editable fields of a Document, shared by the create modal and the inline
 * editor on the detail page.
 */
export interface DocumentFormValues {
  name: string;
  description: string;
  visibility: DocumentVisibility;
  tagIds: string[];
}
