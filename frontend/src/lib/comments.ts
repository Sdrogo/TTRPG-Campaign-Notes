import type {
  BranchState,
  Comment,
  CommentFilters,
  CommentFormValues,
  CommentNode,
} from '../types/comment';
import type { DocumentVisibility } from '../types/document';
import type { Member } from '../types/member';
import { displayNameFor, findMember } from './members';

/** An empty composer: a Room-visible Comment with no images, written as yourself. */
export const EMPTY_COMMENT_VALUES: CommentFormValues = {
  body: '',
  visibility: 'room',
  selectiveUserIds: [],
  newImages: [],
  removedImageIds: [],
};

/** The Comment list's starting state: newest first, nothing filtered out. */
export const DEFAULT_COMMENT_FILTERS: CommentFilters = {
  sort: 'newest',
  query: '',
  authorId: null,
  visibility: null,
  hideDeleted: false,
};

/** Whether a Comment was changed after it was posted. A deleted Comment never counts as edited. */
export function isEdited(comment: Comment): boolean {
  return !comment.deleted && comment.updatedAt !== comment.createdAt;
}

/** Whether any filter would hide Comments. The sort order doesn't count. */
export function hasActiveFilters(filters: CommentFilters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.authorId !== null ||
    filters.visibility !== null ||
    filters.hideDeleted
  );
}

const byCreatedAt = (a: Comment, b: Comment) => Date.parse(a.createdAt) - Date.parse(b.createdAt);

// A search for an author matches the name they're shown by and, since that
// may be a chosen name now, their email too.
function authorMatches(members: Member[], authorId: string, query: string): boolean {
  const author = findMember(members, authorId);
  return [displayNameFor(members, authorId), author?.email ?? ''].some((text) =>
    text.toLocaleLowerCase().includes(query),
  );
}

function sortComments(comments: Comment[], sort: CommentFilters['sort'], members: Member[]) {
  switch (sort) {
    case 'oldest':
      return comments.sort(byCreatedAt);
    case 'newest':
      return comments.sort((a, b) => byCreatedAt(b, a));
    case 'author':
      return comments.sort(
        (a, b) =>
          displayNameFor(members, a.authorId).localeCompare(displayNameFor(members, b.authorId)) ||
          byCreatedAt(a, b),
      );
  }
}

/**
 * Client-side filter + sort over the Comments the backend already returned (so
 * already visibility-filtered). Never mutates its input.
 */
export function applyCommentFilters(
  comments: Comment[],
  filters: CommentFilters,
  members: Member[],
): Comment[] {
  const query = filters.query.trim().toLocaleLowerCase();

  const filtered = comments.filter(
    (comment) =>
      (!filters.hideDeleted || !comment.deleted) &&
      (filters.authorId === null || comment.authorId === filters.authorId) &&
      (filters.visibility === null || comment.visibility === filters.visibility) &&
      (query === '' ||
        comment.body.toLocaleLowerCase().includes(query) ||
        authorMatches(members, comment.authorId, query)),
  );
  return sortComments(filtered, filters.sort, members);
}

/**
 * The top-level Comments of a Thread: those that answer nothing, and replies
 * whose parent the viewer can't see (spec 19 Decision 6), which start their
 * own branch under a placeholder. A reply whose parent isn't in the list is
 * treated the same way rather than dropped.
 */
export function topLevelComments(comments: Comment[]): Comment[] {
  const ids = new Set(comments.map((c) => c.id));
  return comments.filter((c) => c.parentId === null || !ids.has(c.parentId));
}

/**
 * The Thread as a tree (spec 19 Decision 3): the toolbar's filters and sort
 * pick and order the top-level Comments, each shown one brings its whole
 * branch, and replies are ordered with the same sort. Never mutates its input.
 */
export function buildCommentTree(
  comments: Comment[],
  filters: CommentFilters,
  members: Member[],
): CommentNode[] {
  const byParent = new Map<string, Comment[]>();
  for (const comment of comments) {
    if (comment.parentId !== null) {
      byParent.set(comment.parentId, [...(byParent.get(comment.parentId) ?? []), comment]);
    }
  }
  const toNode = (comment: Comment): CommentNode => ({
    comment,
    replies: sortComments([...(byParent.get(comment.id) ?? [])], filters.sort, members).map(toNode),
  });
  return applyCommentFilters(topLevelComments(comments), filters, members).map(toNode);
}

/** How many replies sit below a Comment, at any depth. */
export function countReplies(node: CommentNode): number {
  return node.replies.reduce((total, reply) => total + 1 + countReplies(reply), 0);
}

/** A branch with more replies than this starts collapsed (spec 19 Decision 4). */
export const COLLAPSE_ABOVE = 3;
/** How many replies a collapsed branch still shows. */
export const SHOWN_WHEN_COLLAPSED = 2;

/**
 * The replies to draw under a Comment, and how many are left out. With no
 * choice made by hand (`state` undefined), a branch with more than
 * `COLLAPSE_ABOVE` replies shows its first `SHOWN_WHEN_COLLAPSED` (spec 19
 * Decision 4).
 */
export function visibleReplies(
  node: CommentNode,
  state: BranchState | undefined,
): { shown: CommentNode[]; hiddenCount: number } {
  const total = countReplies(node);
  const shown =
    state === 'closed'
      ? []
      : state === 'open' || total <= COLLAPSE_ABOVE
        ? node.replies
        : node.replies.slice(0, SHOWN_WHEN_COLLAPSED);
  const shownCount = shown.reduce((sum, reply) => sum + 1 + countReplies(reply), 0);
  return { shown, hiddenCount: total - shownCount };
}

/**
 * Who may be named in a reply's Selective grants without reaching past its
 * parent's readers (VR-04): its author and, for a Selective parent, its
 * grantees. Null when anyone may (a Room parent). The Master reads everything,
 * so needs no grant. The backend still decides.
 */
export function replyGranteeIds(parent: Comment): string[] | null {
  if (parent.visibility === 'room') {
    return null;
  }
  const ids = parent.visibility === 'selective' ? parent.selectiveUserIds : [];
  return [...new Set([parent.authorId, ...ids])];
}

/**
 * The visibility levels a reply may take without being wider than its parent
 * (VR-04, spec 19 Decision 2): any under a Room parent, otherwise every level
 * but Room, and Selective only when someone besides the author could be
 * granted.
 */
export function replyLevels(parent: Comment, currentUserId: string): DocumentVisibility[] {
  const grantees = replyGranteeIds(parent);
  if (grantees === null) {
    return ['room', 'master', 'private', 'selective'];
  }
  const canGrant = grantees.some((id) => id !== currentUserId);
  return canGrant ? ['master', 'private', 'selective'] : ['master', 'private'];
}

/**
 * Where a reply's visibility starts (spec 19 Decision 2): its parent's. When
 * the parent was written by someone else and isn't Room-wide, the reply starts
 * Selective to the parent's readers, so the person being answered can read
 * the answer.
 */
export function replyStartVisibility(
  parent: Comment,
  currentUserId: string,
): Pick<CommentFormValues, 'visibility' | 'selectiveUserIds'> {
  const grantees = replyGranteeIds(parent);
  if (grantees === null) {
    return { visibility: 'room', selectiveUserIds: [] };
  }
  if (parent.authorId === currentUserId) {
    return { visibility: parent.visibility, selectiveUserIds: parent.selectiveUserIds };
  }
  return {
    visibility: 'selective',
    selectiveUserIds: grantees.filter((id) => id !== currentUserId),
  };
}

/** The name a Comment is shown by: its Character's, or its author's. */
export function commentShownName(comment: Comment, members: Member[]): string {
  return comment.asCharacter?.name ?? displayNameFor(members, comment.authorId);
}

/** The distinct authors among `comments`, for the author filter. */
export function commentAuthors(comments: Comment[], members: Member[]) {
  const ids = [...new Set(comments.map((c) => c.authorId))];
  return ids
    .map((id) => ({ value: id, label: displayNameFor(members, id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
