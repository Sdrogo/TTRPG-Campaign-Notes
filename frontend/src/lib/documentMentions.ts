import type { Document } from '../types/document';
import type { Tag } from '../types/tag';

// Document mentions (FR-D4, spec `06 - Quick navigation`): typing `#` at the
// start of a word suggests the Room's Documents; picking one writes
// `#Document name` into the text, which is rendered as a link. Mentions are
// stored as plain, readable text and resolved against the Documents the
// viewer can see, so a mention of a hidden Document stays plain text.

export const MENTION_PREFIX = '#';
export const MAX_MENTION_SUGGESTIONS = 8;
// Past this length a `#…` run is prose, not a mention being typed.
const MAX_QUERY_LENGTH = 80;

// A `#` counts as a mention start at the beginning of the text, after
// whitespace, or after an opening bracket.
const MENTION_BOUNDARY = /[\s([{]/;
// A mention must end on a word boundary: `#Rome` doesn't match `#Romeo`.
const WORD_CHAR = /[\p{L}\p{N}_]/u;

export interface MentionQuery {
  // Index of the `#` in the text.
  start: number;
  // What was typed after the `#`, up to the caret.
  query: string;
}

export interface MentionCandidate {
  document: Document;
  tags: Tag[];
}

export type MentionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; document: Document };

export type MentionKeyAction = 'next' | 'previous' | 'select' | 'close';

function isMentionStart(text: string, index: number): boolean {
  return (
    text[index] === MENTION_PREFIX && (index === 0 || MENTION_BOUNDARY.test(text[index - 1]))
  );
}

// Lowercase and without accents, so "citta" finds "Città".
export function normalizeForSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

// The mention being typed at the caret, if any.
export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf(MENTION_PREFIX);
  if (start === -1 || !isMentionStart(before, start)) {
    return null;
  }
  const query = before.slice(start + 1);
  if (query.length > MAX_QUERY_LENGTH || query.includes('\n') || /^\s/.test(query)) {
    return null;
  }
  return { start, query };
}

// Lower is better; null means the Document doesn't match at all.
function matchRank(document: Document, documentTags: Tag[], query: string): number | null {
  if (query === '') {
    return 0;
  }
  const name = normalizeForSearch(document.name);
  if (name.startsWith(query)) return 0;
  if (name.split(/\s+/).some((word) => word.startsWith(query))) return 1;
  if (name.includes(query)) return 2;
  const tagNames = documentTags.map((tag) => normalizeForSearch(tag.name));
  if (tagNames.some((tag) => tag.startsWith(query))) return 3;
  if (tagNames.some((tag) => tag.includes(query))) return 4;
  return null;
}

// Documents matching the query by name or by one of their Tags, best
// matches first (name before Tag), then alphabetically.
export function filterMentionCandidates(
  documents: Document[],
  tags: Tag[],
  query: string,
  limit = MAX_MENTION_SUGGESTIONS,
): MentionCandidate[] {
  const normalizedQuery = normalizeForSearch(query);
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));

  return documents
    .map((document) => {
      const documentTags = document.tagIds.flatMap((id) => tagsById.get(id) ?? []);
      return { document, tags: documentTags, rank: matchRank(document, documentTags, normalizedQuery) };
    })
    .filter((entry): entry is MentionCandidate & { rank: number } => entry.rank !== null)
    .sort(
      (a, b) =>
        a.rank - b.rank || a.document.name.localeCompare(b.document.name, 'it', { sensitivity: 'base' }),
    )
    .slice(0, limit)
    .map(({ document, tags: documentTags }) => ({ document, tags: documentTags }));
}

// Replaces the `#query` being typed with `#Document name`, followed by a
// space unless one is already there. Returns the new text and caret.
export function insertMention(
  text: string,
  mention: MentionQuery,
  caret: number,
  documentName: string,
): { text: string; caret: number } {
  const after = text.slice(caret);
  const inserted = `${MENTION_PREFIX}${documentName}${/^\s/.test(after) ? '' : ' '}`;
  return {
    text: text.slice(0, mention.start) + inserted + after,
    caret: mention.start + inserted.length,
  };
}

// Splits text into plain runs and mentions of the given Documents. At each
// `#` the longest matching name wins, compared ignoring case.
export function splitMentions(text: string, documents: Document[]): MentionSegment[] {
  const byLongestName = documents
    .filter((document) => document.name.trim() !== '')
    .toSorted((a, b) => b.name.length - a.name.length);
  const segments: MentionSegment[] = [];
  let plainStart = 0;
  let index = text.indexOf(MENTION_PREFIX);

  while (index !== -1 && byLongestName.length > 0) {
    const document = isMentionStart(text, index)
      ? byLongestName.find((candidate) => mentionsAt(text, index + 1, candidate.name))
      : undefined;
    if (document) {
      const end = index + 1 + document.name.length;
      if (index > plainStart) {
        segments.push({ kind: 'text', text: text.slice(plainStart, index) });
      }
      segments.push({ kind: 'mention', text: text.slice(index, end), document });
      plainStart = end;
      index = text.indexOf(MENTION_PREFIX, end);
    } else {
      index = text.indexOf(MENTION_PREFIX, index + 1);
    }
  }

  if (plainStart < text.length) {
    segments.push({ kind: 'text', text: text.slice(plainStart) });
  }
  return segments;
}

function mentionsAt(text: string, position: number, name: string): boolean {
  const candidate = text.slice(position, position + name.length);
  const next = text[position + name.length];
  return (
    candidate.length === name.length &&
    candidate.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0 &&
    (next === undefined || !WORD_CHAR.test(next))
  );
}

// What a key does while the suggestions are open (null: let it through, so
// e.g. Ctrl+Enter still submits a Comment).
export function mentionKeyAction(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): MentionKeyAction | null {
  const modified = event.ctrlKey || event.metaKey || event.altKey;
  switch (event.key) {
    case 'ArrowDown':
      return modified ? null : 'next';
    case 'ArrowUp':
      return modified ? null : 'previous';
    case 'Enter':
      return modified || event.shiftKey ? null : 'select';
    case 'Tab':
      return modified || event.shiftKey ? null : 'select';
    case 'Escape':
      return 'close';
    default:
      return null;
  }
}

// Moves the highlighted suggestion, wrapping around at either end.
export function moveActiveIndex(current: number, count: number, direction: 1 | -1): number {
  if (count === 0) {
    return 0;
  }
  return (current + direction + count) % count;
}
