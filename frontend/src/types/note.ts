import type { DocumentVisibility } from './document';

/**
 * An additional block of information on a Document (spec 12): a title, a
 * description and a visibility of its own. This is the Detail of D-18 under
 * the product's own name, managed by Owners and the Master rather than written
 * by any member. The backend only sends the Notes the viewer may see, so there
 * is no "hidden" Note here.
 */
export interface Note {
  id: string;
  documentId: string;
  title: string;
  description: string;
  visibility: DocumentVisibility;
  /** Sent only to those who can edit the Note; empty for a plain reader. */
  selectiveUserIds: string[];
  position: number;
  createdAt: string;
  updatedAt: string;
  /** Decided by the backend for the current viewer. */
  canEdit: boolean;
  canDelete: boolean;
}

/** The editable fields of a Note, shared by the add form and inline edit. */
export interface NoteFormValues {
  title: string;
  description: string;
  visibility: DocumentVisibility;
  selectiveUserIds: string[];
}
