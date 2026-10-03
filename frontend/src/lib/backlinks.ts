import type { Backlink } from '../types/backlink';

/** The link to where a mention is: its Document, or the Comment's anchor there. */
export function backlinkHref(roomId: string, documentId: string, mention: Backlink): string {
  const page = `/rooms/${roomId}/documents/${documentId}`;
  return mention.commentId ? `${page}#comment-${mention.commentId}` : page;
}
