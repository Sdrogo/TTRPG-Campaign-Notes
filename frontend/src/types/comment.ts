import type { Character } from './character';
import type { DocumentVisibility } from './document';
import type { PendingImage, StoredImage } from './image';

/**
 * A Post of kind Comment in a Document's main Thread. Uses the same visibility
 * levels as a Document (VR-03), with the author as its Owner.
 */
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
  /** Also shown in the Document's gallery (they're Document images too). */
  images: StoredImage[];
  /** Decided by the backend for the current viewer. */
  canEdit: boolean;
  canDelete: boolean;
  /**
   * The Character the Comment was written as (D-24), or null. The backend
   * leaves it null for a viewer who can't see that Character's Document
   * (VR-13), who then sees the real author like any other Comment.
   */
  asCharacter: Character | null;
  /** The Comment this one answers (spec 19), null for a top-level Comment. */
  parentId: string | null;
  /**
   * True for a reply whose parent the viewer can't see: only its own author
   * gets one (spec 19 Decision 6). `parentId` is then null, and the reply is
   * drawn under a placeholder that tells nothing about the parent.
   */
  parentHidden: boolean;
}

/** The editable fields of a Comment, shared by the composer and inline edit. */
export interface CommentFormValues {
  body: string;
  visibility: DocumentVisibility;
  selectiveUserIds: string[];
  /** Images to upload on save, and ids of already attached ones to remove. */
  newImages: PendingImage[];
  removedImageIds: string[];
  /**
   * The Document to write as (D-24), null to write as yourself. Left
   * undefined, an edit keeps the Comment's current choice.
   */
  asDocumentId?: string | null;
  /** The Comment a new Comment answers (spec 19). Ignored when editing. */
  parentId?: string;
}

/** How the Comment list is ordered: by date either way, or grouped by author name. */
export type CommentSortOrder = 'newest' | 'oldest' | 'author';

/**
 * The Comment list's client-side filters and sort. Applied by
 * `applyCommentFilters` to Comments the backend already filtered for
 * visibility.
 */
export interface CommentFilters {
  sort: CommentSortOrder;
  query: string;
  authorId: string | null;
  visibility: DocumentVisibility | null;
  hideDeleted: boolean;
}

/** A Comment with the replies drawn under it (spec 19). */
export interface CommentNode {
  comment: Comment;
  replies: CommentNode[];
}

/**
 * A branch expanded or collapsed by hand. A branch nobody touched follows the
 * default of spec 19 Decision 4 (`visibleReplies`).
 */
export type BranchState = 'open' | 'closed';
