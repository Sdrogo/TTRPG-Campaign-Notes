import type { Comment, CommentFilters } from '../types/comment';
import type { Member } from '../types/member';
import { displayNameFor } from './members';

export const DEFAULT_COMMENT_FILTERS: CommentFilters = {
  sort: 'newest',
  query: '',
  authorId: null,
  visibility: null,
  hideDeleted: false,
};

export function isEdited(comment: Comment): boolean {
  return !comment.deleted && comment.updatedAt !== comment.createdAt;
}

export function hasActiveFilters(filters: CommentFilters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.authorId !== null ||
    filters.visibility !== null ||
    filters.hideDeleted
  );
}

const byCreatedAt = (a: Comment, b: Comment) => Date.parse(a.createdAt) - Date.parse(b.createdAt);

// Client-side filter + sort over the Comments the backend already returned
// (so already visibility-filtered). Never mutates its input.
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
        displayNameFor(members, comment.authorId).toLocaleLowerCase().includes(query)),
  );

  switch (filters.sort) {
    case 'oldest':
      return filtered.sort(byCreatedAt);
    case 'newest':
      return filtered.sort((a, b) => byCreatedAt(b, a));
    case 'author':
      return filtered.sort(
        (a, b) =>
          displayNameFor(members, a.authorId).localeCompare(displayNameFor(members, b.authorId)) ||
          byCreatedAt(a, b),
      );
  }
}

// The distinct authors among `comments`, for the author filter.
export function commentAuthors(comments: Comment[], members: Member[]) {
  const ids = [...new Set(comments.map((c) => c.authorId))];
  return ids
    .map((id) => ({ value: id, label: displayNameFor(members, id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
