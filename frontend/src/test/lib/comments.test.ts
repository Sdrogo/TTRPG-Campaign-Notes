import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMMENT_FILTERS,
  applyCommentFilters,
  buildCommentTree,
  commentAuthors,
  commentShownName,
  countReplies,
  hasActiveFilters,
  isEdited,
  isNewComment,
  replyGranteeIds,
  replyLevels,
  replyStartVisibility,
  topLevelComments,
  visibleReplies,
} from '../../lib/comments';
import type { Comment, CommentFilters, CommentNode } from '../../types/comment';
import type { Member } from '../../types/member';

const noProfile = { displayName: null, pronouns: null, bio: null, avatarUrl: null };

const members: Member[] = [
  { ...noProfile, userId: 'u-zed', email: 'zed@example.com', role: 'player', isAdmin: false },
  { ...noProfile, userId: 'u-ann', email: 'ann@example.com', role: 'master', isAdmin: true },
];

function comment(id: string, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    documentId: 'doc',
    authorId: 'u-zed',
    body: `body ${id}`,
    visibility: 'room',
    selectiveUserIds: [],
    createdAt: '2026-09-21T10:00:00Z',
    updatedAt: '2026-09-21T10:00:00Z',
    deleted: false,
    images: [],
    canEdit: false,
    canDelete: false,
    asCharacter: null,
    parentId: null,
    parentHidden: false,
    ...overrides,
  };
}

const comments = [
  comment('a', { createdAt: '2026-09-21T10:00:00Z', updatedAt: '2026-09-21T10:00:00Z' }),
  comment('b', {
    authorId: 'u-ann',
    body: 'The Count is watching',
    visibility: 'private',
    createdAt: '2026-09-21T12:00:00Z',
    updatedAt: '2026-09-21T12:00:00Z',
  }),
  comment('c', {
    body: '',
    deleted: true,
    createdAt: '2026-09-21T11:00:00Z',
    updatedAt: '2026-09-21T13:00:00Z',
  }),
];

const ids = (list: Comment[]) => list.map((c) => c.id);
const filters = (overrides: Partial<CommentFilters>) => ({ ...DEFAULT_COMMENT_FILTERS, ...overrides });

describe('applyCommentFilters', () => {
  it('sorts newest first by default', () => {
    expect(ids(applyCommentFilters(comments, DEFAULT_COMMENT_FILTERS, members))).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('sorts oldest first', () => {
    expect(ids(applyCommentFilters(comments, filters({ sort: 'oldest' }), members))).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('sorts by author name, then by date', () => {
    expect(ids(applyCommentFilters(comments, filters({ sort: 'author' }), members))).toEqual([
      'b', // ann
      'a', // zed, 10:00
      'c', // zed, 11:00
    ]);
  });

  it('filters by author', () => {
    expect(ids(applyCommentFilters(comments, filters({ authorId: 'u-ann' }), members))).toEqual([
      'b',
    ]);
  });

  it('filters by visibility', () => {
    expect(
      ids(applyCommentFilters(comments, filters({ visibility: 'private' }), members)),
    ).toEqual(['b']);
  });

  it('searches the body and the author name, case-insensitively', () => {
    expect(ids(applyCommentFilters(comments, filters({ query: 'COUNT' }), members))).toEqual(['b']);
    expect(ids(applyCommentFilters(comments, filters({ query: 'ann@' }), members))).toEqual(['b']);
  });

  it('uses chosen names, and still finds an author by email', () => {
    // Zed picked a name that sorts before Ann's email.
    const named = members.map((m) => (m.userId === 'u-zed' ? { ...m, displayName: 'Abelard' } : m));

    expect(commentAuthors(comments, named).map((a) => a.label)).toEqual([
      'Abelard',
      'ann@example.com',
    ]);
    const byName = ids(applyCommentFilters(comments, filters({ query: 'abel' }), named));
    const byEmail = ids(applyCommentFilters(comments, filters({ query: 'zed@' }), named));
    expect(byName).not.toEqual([]);
    expect(byEmail).toEqual(byName);
  });

  it('searching by author name never crashes on a Comment from a departed member', () => {
    const orphan = [comment('c', { authorId: 'u-gone', body: 'nothing matches this' })];

    expect(ids(applyCommentFilters(orphan, filters({ query: 'zed' }), members))).toEqual([]);
  });

  it('can hide deleted placeholders', () => {
    expect(
      ids(applyCommentFilters(comments, filters({ hideDeleted: true, sort: 'oldest' }), members)),
    ).toEqual(['a', 'b']);
  });

  it('does not mutate its input', () => {
    const input = [...comments];
    applyCommentFilters(input, filters({ sort: 'newest' }), members);
    expect(ids(input)).toEqual(['a', 'b', 'c']);
  });
});

describe('helpers', () => {
  it('isEdited ignores deleted placeholders', () => {
    expect(isEdited(comment('x', { updatedAt: '2026-09-21T11:00:00Z' }))).toBe(true);
    expect(isEdited(comments[0])).toBe(false);
    expect(isEdited(comments[2])).toBe(false);
  });

  it('hasActiveFilters ignores the sort order', () => {
    expect(hasActiveFilters(filters({ sort: 'author' }))).toBe(false);
    expect(hasActiveFilters(filters({ query: '  x ' }))).toBe(true);
  });

  it('commentAuthors lists each author once, by name', () => {
    expect(commentAuthors(comments, members)).toEqual([
      { value: 'u-ann', label: 'ann@example.com' },
      { value: 'u-zed', label: 'zed@example.com' },
    ]);
  });
});

// --- Threaded replies (spec 19) ---------------------------------------------

const at = (minute: number) => `2026-09-21T10:${String(minute).padStart(2, '0')}:00Z`;

function reply(id: string, parentId: string, minute: number, overrides: Partial<Comment> = {}) {
  return comment(id, { parentId, createdAt: at(minute), updatedAt: at(minute), ...overrides });
}

// Renders a tree as "id(child,child)" for compact assertions.
function shape(nodes: CommentNode[]): string {
  return nodes
    .map((n) => (n.replies.length ? `${n.comment.id}(${shape(n.replies)})` : n.comment.id))
    .join(',');
}

const thread = [
  comment('top1', { createdAt: at(0), updatedAt: at(0), body: 'the bridge' }),
  comment('top2', { createdAt: at(10), updatedAt: at(10), authorId: 'u-ann' }),
  reply('r1', 'top1', 1),
  reply('r2', 'top1', 2, { authorId: 'u-ann', body: 'about the bridge too' }),
  reply('r1a', 'r1', 3),
];

describe('buildCommentTree (Decision 3)', () => {
  it('nests replies under what they answer, in the same sort as the top level', () => {
    expect(shape(buildCommentTree(thread, filters({ sort: 'oldest' }), members))).toBe(
      'top1(r1(r1a),r2),top2',
    );
    expect(shape(buildCommentTree(thread, DEFAULT_COMMENT_FILTERS, members))).toBe(
      'top2,top1(r2,r1(r1a))',
    );
  });

  it('filters pick top-level Comments, which bring their whole branch', () => {
    // r2 is by Ann, but only top-level authors count.
    expect(shape(buildCommentTree(thread, filters({ authorId: 'u-ann' }), members))).toBe('top2');
    // A match in a reply alone doesn't bring its branch.
    expect(shape(buildCommentTree(thread, filters({ query: 'too' }), members))).toBe('');
    expect(shape(buildCommentTree(thread, filters({ query: 'bridge', sort: 'oldest' }), members))).toBe(
      'top1(r1(r1a),r2)',
    );
  });

  // FR-T5: a deleted Comment's placeholder keeps the live replies under it readable.
  it('hides a deleted Comment only when nothing live sits under it', () => {
    const list = [
      comment('gone', { deleted: true, body: '', createdAt: at(0), updatedAt: at(0) }),
      reply('live', 'gone', 1),
      reply('dead-leaf', 'live', 2, { deleted: true, body: '' }),
      comment('lonely', { deleted: true, body: '', createdAt: at(5), updatedAt: at(5) }),
    ];
    const hide = filters({ hideDeleted: true, sort: 'oldest' });
    expect(shape(buildCommentTree(list, hide, members))).toBe('gone(live)');
    expect(shape(buildCommentTree(list, filters({ sort: 'oldest' }), members))).toBe(
      'gone(live(dead-leaf)),lonely',
    );
  });

  it('starts a branch at a reply whose parent is hidden or missing', () => {
    const list = [
      comment('mine', { parentHidden: true }),
      reply('stray', 'gone', 5),
      reply('under-mine', 'mine', 6),
    ];
    expect(topLevelComments(list).map((c) => c.id)).toEqual(['mine', 'stray']);
    expect(shape(buildCommentTree(list, filters({ sort: 'oldest' }), members))).toBe(
      'mine(under-mine),stray',
    );
  });

  it('does not mutate its input', () => {
    const input = [...thread];
    buildCommentTree(input, DEFAULT_COMMENT_FILTERS, members);
    expect(ids(input)).toEqual(ids(thread));
  });
});

describe('visibleReplies (Decision 4)', () => {
  const node = (id: string, replies: CommentNode[] = []): CommentNode => ({
    comment: comment(id),
    replies,
  });
  const big = node('top', [node('a', [node('a1')]), node('b'), node('c'), node('d')]);

  it('counts replies at every depth', () => {
    expect(countReplies(big)).toBe(5);
  });

  it('starts a branch with more than 3 replies collapsed to its first 2', () => {
    const { shown, hiddenCount } = visibleReplies(big, undefined);
    expect(shown.map((n) => n.comment.id)).toEqual(['a', 'b']);
    expect(hiddenCount).toBe(2);
  });

  it('shows a short branch whole, and follows a choice made by hand', () => {
    const small = node('top', [node('a'), node('b'), node('c')]);
    const none = { hiddenCount: 0, hiddenNewCount: 0 };
    expect(visibleReplies(small, undefined)).toEqual({ shown: small.replies, ...none });
    expect(visibleReplies(big, 'open')).toEqual({ shown: big.replies, ...none });
    expect(visibleReplies(small, 'closed')).toEqual({
      shown: [],
      hiddenCount: 3,
      hiddenNewCount: 0,
    });
  });

  // Spec 19b: a collapsed branch never hides what is new.
  it('starts expanded when a reply it would hide is new', () => {
    const isNew = (c: Comment) => c.id === 'd';
    expect(visibleReplies(big, undefined, isNew)).toEqual({
      shown: big.replies,
      hiddenCount: 0,
      hiddenNewCount: 0,
    });
  });

  it('stays collapsed when the new replies are already shown', () => {
    const isNew = (c: Comment) => c.id === 'a1';
    const { shown, hiddenNewCount } = visibleReplies(big, undefined, isNew);
    expect(shown.map((n) => n.comment.id)).toEqual(['a', 'b']);
    expect(hiddenNewCount).toBe(0);
  });

  it('counts the new replies a branch closed by hand hides', () => {
    const isNew = (c: Comment) => ['a1', 'c'].includes(c.id);
    expect(visibleReplies(big, 'closed', isNew)).toEqual({
      shown: [],
      hiddenCount: 5,
      hiddenNewCount: 2,
    });
  });
});

describe('isNewComment (spec 19b Decision 1)', () => {
  const since = '2026-09-21T10:00:00Z';
  const later = { createdAt: '2026-09-21T11:00:00Z' };

  it('marks a Comment by someone else posted after the previous visit', () => {
    expect(isNewComment(comment('a', later), since, 'u-me')).toBe(true);
  });

  it('never marks older, own or deleted Comments', () => {
    expect(isNewComment(comment('a', { createdAt: since }), since, 'u-me')).toBe(false);
    expect(isNewComment(comment('a', later), since, 'u-zed')).toBe(false);
    expect(isNewComment(comment('a', { ...later, deleted: true }), since, 'u-me')).toBe(false);
  });

  it('marks nothing on a first visit or before the visit is recorded', () => {
    expect(isNewComment(comment('a', later), null, 'u-me')).toBe(false);
    expect(isNewComment(comment('a', later), undefined, 'u-me')).toBe(false);
  });
});

describe('reply visibility (Decision 2, VR-04)', () => {
  const parent = (overrides: Partial<Comment>) => comment('p', { authorId: 'u-ann', ...overrides });

  it('offers every level under a Room parent', () => {
    expect(replyLevels(parent({}), 'u-zed')).toEqual(['room', 'master', 'private', 'selective']);
    expect(replyGranteeIds(parent({}))).toBeNull();
    expect(replyStartVisibility(parent({}), 'u-zed')).toEqual({
      visibility: 'room',
      selectiveUserIds: [],
    });
  });

  it('never offers Room under a narrower parent, and grants only its readers', () => {
    const selective = parent({ visibility: 'selective', selectiveUserIds: ['u-zed', 'u-bob'] });
    expect(replyLevels(selective, 'u-zed')).toEqual(['master', 'private', 'selective']);
    expect(replyGranteeIds(selective)).toEqual(['u-ann', 'u-zed', 'u-bob']);
    // Answering someone else starts Selective to the parent's readers, so the
    // person answered can read it.
    expect(replyStartVisibility(selective, 'u-zed')).toEqual({
      visibility: 'selective',
      selectiveUserIds: ['u-ann', 'u-bob'],
    });
  });

  it('starts from the parent as it is when answering yourself', () => {
    const own = parent({ visibility: 'private' });
    expect(replyStartVisibility(own, 'u-ann')).toEqual({
      visibility: 'private',
      selectiveUserIds: [],
    });
    // Nobody else reads a Private Comment, so there is nobody to grant.
    expect(replyLevels(own, 'u-ann')).toEqual(['master', 'private']);
  });

  it('shows a Comment by its Character, or its author', () => {
    expect(commentShownName(comment('x'), members)).toBe('zed@example.com');
    expect(
      commentShownName(
        comment('x', { asCharacter: { documentId: 'd', name: 'Aria', imageUrl: null } }),
        members,
      ),
    ).toBe('Aria');
  });
});
