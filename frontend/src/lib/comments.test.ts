import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMMENT_FILTERS,
  applyCommentFilters,
  commentAuthors,
  hasActiveFilters,
  isEdited,
} from './comments';
import type { Comment, CommentFilters } from '../types/comment';
import type { Member } from '../types/member';

const members: Member[] = [
  { userId: 'u-zed', email: 'zed@example.com', role: 'player', isAdmin: false },
  { userId: 'u-ann', email: 'ann@example.com', role: 'master', isAdmin: true },
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
