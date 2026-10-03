import type { Comment } from '../types/comment';
import type { Document } from '../types/document';
import type { Member } from '../types/member';
import type { Note } from '../types/note';
import type { MyReveal, RevealAudience } from '../types/reveal';
import { seesComment, seesContent, type PromotionAudience } from './promotion';

// Revealing (spec 22, FR-V2, UC-13): the Master widens who sees a Document, a
// Note or a Comment in one step. These rules mirror the backend's
// (`app/domain/reveal.py`), which still decides: they only drive the dialog,
// telling the Master who gains access before they confirm.

/** Who sees a piece of content on its own: its level, Owners and grants. */
export type ContentAudience = PromotionAudience;

/** No audience chosen yet: the dialog's starting point. */
export const NO_AUDIENCE: RevealAudience = { toRoom: false, userIds: [] };

/**
 * The content's own audience once revealed: Room to the whole Room (or if it
 * already was); chosen members added to a Selective list; a Master-only or
 * Private item revealed to chosen members becomes Selective with them alone.
 * Nobody chosen changes nothing (the backend refuses it).
 */
export function revealedAudience(
  current: ContentAudience,
  audience: RevealAudience,
): ContentAudience {
  if (!audience.toRoom && audience.userIds.length === 0) return current;
  if (audience.toRoom || current.visibility === 'room') {
    return { ...current, visibility: 'room', selectiveUserIds: [] };
  }
  const granted = current.visibility === 'selective' ? current.selectiveUserIds : [];
  return {
    ...current,
    visibility: 'selective',
    selectiveUserIds: [...new Set([...granted, ...audience.userIds])],
  };
}

function sees(member: Member, audience: ContentAudience): boolean {
  return seesContent(member, audience.visibility, audience.ownerIds, audience.selectiveUserIds);
}

/**
 * Whether revealing to `audience` lets anyone new see the content on its own
 * terms (the backend refuses a Reveal that widens nothing).
 */
export function revealWidens(
  current: ContentAudience,
  audience: RevealAudience,
  members: Member[],
): boolean {
  const after = revealedAudience(current, audience);
  return members.some((member) => !sees(member, current) && sees(member, after));
}

/** A Document's own audience. */
export function documentAudience(document: Document): ContentAudience {
  return {
    visibility: document.visibility,
    ownerIds: document.ownerIds,
    selectiveUserIds: document.selectiveUserIds,
  };
}

/** A Note's own audience: its level and grants, with its Document's Owners. */
export function noteAudience(note: Note, document: Document): ContentAudience {
  return {
    visibility: note.visibility,
    ownerIds: document.ownerIds,
    selectiveUserIds: note.selectiveUserIds,
  };
}

/** A Comment's own audience: its level and grants, its author as Owner. */
export function commentAudience(comment: Comment): ContentAudience {
  return {
    visibility: comment.visibility,
    ownerIds: [comment.authorId],
    selectiveUserIds: comment.selectiveUserIds,
  };
}

/**
 * Who a Reveal of the Document would let in, and who the dialog can pick:
 * the members who don't see it now.
 */
export function documentReveal(document: Document, members: Member[]) {
  const current = documentAudience(document);
  return {
    current,
    pickable: members.filter((member) => !sees(member, current)),
    gains: (audience: RevealAudience) => {
      const after = revealedAudience(current, audience);
      return members.filter((member) => !sees(member, current) && sees(member, after));
    },
  };
}

/**
 * The same for one Note: only members who see its Document can gain it, so
 * only they can be picked.
 */
export function noteReveal(note: Note, document: Document, members: Member[]) {
  const current = noteAudience(note, document);
  const readers = members.filter((member) => sees(member, documentAudience(document)));
  return {
    current,
    pickable: readers.filter((member) => !sees(member, current)),
    gains: (audience: RevealAudience) => {
      const after = revealedAudience(current, audience);
      return readers.filter((member) => !sees(member, current) && sees(member, after));
    },
  };
}

/**
 * The same for one Comment, on its effective visibility: a reply stays
 * hidden from whoever can't see a Comment above it. `comments` is the Thread.
 */
export function commentReveal(
  comment: Comment,
  comments: Comment[],
  document: Document,
  members: Member[],
) {
  const current = commentAudience(comment);
  const byId = new Map(comments.map((c) => [c.id, c]));
  const readers = members.filter((member) => sees(member, documentAudience(document)));
  const seesNow = (member: Member) => seesComment(member, comment, byId);
  return {
    current,
    pickable: readers.filter((member) => !seesNow(member)),
    gains: (audience: RevealAudience) => {
      const after = revealedAudience(current, audience);
      const revealed: Comment = {
        ...comment,
        visibility: after.visibility,
        selectiveUserIds: after.selectiveUserIds,
      };
      const afterById = new Map(byId).set(comment.id, revealed);
      return readers.filter(
        (member) => !seesNow(member) && seesComment(member, revealed, afterById),
      );
    },
  };
}

/**
 * The Document's Notes that some member gaining the Document still wouldn't
 * see (spec 22 Decision 2): the dialog offers to reveal them in the same
 * step, each unchecked.
 */
export function notesHiddenFromGains(document: Document, gains: Member[]): Note[] {
  return document.notes.filter((note) =>
    gains.some((member) => !sees(member, noteAudience(note, document))),
  );
}

/**
 * Whether the viewer has an unseen Reveal about this Document or anything on
 * it, for the "Revealed" mark on its card: opening it opens them all.
 */
export function hasUnseenReveal(reveals: MyReveal[] | undefined, documentId: string): boolean {
  return (reveals ?? []).some((reveal) => reveal.documentId === documentId);
}
