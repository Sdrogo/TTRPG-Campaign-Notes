import type { DocumentVisibility } from './document';

/** What a Reveal or a visibility change is about (spec 22). */
export type ContentKind = 'document' | 'note' | 'comment';

/**
 * Who the Master reveals to (spec 22 Decision 1): the whole Room, or these
 * members added to who already sees the content.
 */
export interface RevealAudience {
  toRoom: boolean;
  userIds: string[];
}

/**
 * Content revealed to the signed-in user that they haven't opened yet (spec 22
 * Decision 3), for the header badge and the Account page. `documentId` is the
 * Document the content is, or is on.
 */
export interface MyReveal {
  id: string;
  roomId: string;
  kind: ContentKind;
  documentId: string;
  noteId: string | null;
  commentId: string | null;
  revealedAt: string;
  roomName: string;
  documentName: string;
  noteTitle: string | null;
}

/**
 * What opening a Document marked seen (spec 22 Decision 3): the page marks
 * these "Revealed" for this visit.
 */
export interface RevealedInDocument {
  document: boolean;
  noteIds: string[];
  commentIds: string[];
}

/** Whether a history entry's content can be named for the reader (VR-07). */
export type HistoryContentState = 'visible' | 'hidden' | 'deleted';

/**
 * One change in a Room's visibility history (spec 22 Decision 4). Unless
 * `state` is `visible`, the content isn't named: its ids and names are null
 * and the lists empty.
 */
export interface HistoryEntry {
  id: string;
  createdAt: string;
  actorId: string;
  kind: ContentKind;
  isReveal: boolean;
  state: HistoryContentState;
  fromVisibility: DocumentVisibility;
  toVisibility: DocumentVisibility;
  documentId: string | null;
  documentName: string | null;
  noteId: string | null;
  noteTitle: string | null;
  commentId: string | null;
  selectiveUserIds: string[];
  /** For a Reveal, the members who gained access. */
  recipientIds: string[];
}

/** A page of the history, newest first; `nextBefore` is null on the last one. */
export interface HistoryPage {
  entries: HistoryEntry[];
  nextBefore: string | null;
}
