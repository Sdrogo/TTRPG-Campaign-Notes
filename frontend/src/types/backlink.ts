/** Where a mention sits in its source Document (spec 20 Decision 3). */
export type BacklinkSource = 'description' | 'note' | 'comment';

/** One place a Document mentions the target, with the text around it. */
export interface Backlink {
  kind: BacklinkSource;
  noteId: string | null;
  noteTitle: string | null;
  commentId: string | null;
  commentAuthorId: string | null;
  /** About 120 characters around the mention, as a reader sees them. */
  excerpt: string;
}

/** A Document that mentions the target, with every place it does. */
export interface BacklinkGroup {
  documentId: string;
  documentName: string;
  mentions: Backlink[];
}

/** What the "Mentioned in" list is for: a Document or a Tag. */
export type BacklinkTarget = { kind: 'document'; id: string } | { kind: 'tag'; id: string };
