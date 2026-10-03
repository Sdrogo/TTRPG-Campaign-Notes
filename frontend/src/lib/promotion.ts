import type { Comment } from '../types/comment';
import type { DocumentVisibility } from '../types/document';
import type { Member } from '../types/member';
import { toDisplay } from './userMentions';

// Promoting a Comment (spec 19c Decision 5, FR-T8): an Owner or the Master
// takes its text into the Document's description or into a new Document.
// Promotion can widen who reads the text, so the promoter confirms first.
// These rules mirror the backend's (`app/domain/visibility.py`,
// `app/domain/promotion.py::newly_reached_members`), which still decides.

/** Who reads the Document the text goes into. */
export interface PromotionAudience {
  visibility: DocumentVisibility;
  /** Its explicit Owners; the Master's implicit Ownership is by role. */
  ownerIds: string[];
  selectiveUserIds: string[];
}

// Section 8 of requirements.md, for content with an "Owner" (a Document's
// Owners, a Comment's author). The Master sees everything.
function seesContent(
  member: Member,
  visibility: DocumentVisibility,
  ownerIds: string[],
  selectiveUserIds: string[],
): boolean {
  if (member.role === 'master') return true;
  switch (visibility) {
    case 'room':
      return true;
    case 'master':
      return false;
    case 'private':
      return ownerIds.includes(member.userId);
    case 'selective':
      return ownerIds.includes(member.userId) || selectiveUserIds.includes(member.userId);
  }
}

// A Comment's effective visibility (spec 19): its own and, for a reply, every
// Comment above it, except that an author always sees their own Comment. A
// parent missing from the list is treated as hidden.
function seesComment(member: Member, comment: Comment, byId: Map<string, Comment>): boolean {
  let current: Comment | undefined = comment;
  while (current) {
    if (current.authorId === member.userId) return true;
    if (!seesContent(member, current.visibility, [current.authorId], current.selectiveUserIds)) {
      return false;
    }
    if (current.parentId === null) return true;
    current = byId.get(current.parentId);
  }
  return false;
}

/**
 * The members who would read the promoted text but can't read `comment` now:
 * when there are any, the promoter must confirm (the backend refuses
 * otherwise). `comments` is the Thread, for the parents of a reply.
 */
export function promotionReaches(
  comment: Comment,
  comments: Comment[],
  members: Member[],
  target: PromotionAudience,
): Member[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  return members.filter(
    (member) =>
      seesContent(member, target.visibility, target.ownerIds, target.selectiveUserIds) &&
      !seesComment(member, comment, byId),
  );
}

/** The Comment's text as it reads, member mentions as `@Name`. */
export function promotedText(comment: Comment): string {
  return toDisplay(comment.body);
}

/** `description` with the Comment's text added at the end, as a paragraph of its own. */
export function appendPromotedText(description: string, comment: Comment): string {
  const text = promotedText(comment);
  return description.trim() === '' ? text : `${description.trimEnd()}\n\n${text}`;
}

/**
 * The visibility a new Document made from `comment` starts at, so promoting
 * widens nothing by default: Room stays Room, anything narrower starts
 * Private (its creator and the Master). A new Document has no Selective grants
 * to copy, and a "Master only" one would hide it from its own creator.
 */
export function startingVisibility(comment: Comment): DocumentVisibility {
  return comment.visibility === 'room' ? 'room' : 'private';
}
