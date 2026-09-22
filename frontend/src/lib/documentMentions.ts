import type { Document } from '../types/document';
import type { Tag } from '../types/tag';

// Mentions (FR-D4, specs `06 - Quick navigation` and `06_1 - … refnment`):
// typing `#` at the start of a word suggests the Room's Documents and Tags;
// picking one writes `#Name` into the text, rendered as a link (to the
// Document, or to the Documents with that Tag). Mentions are stored as
// plain, readable text and resolved against what the viewer can see, so a
// mention of a hidden Document stays plain text.

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

export type MentionKind = 'document' | 'tag';

export type MentionTarget =
  | { kind: 'document'; document: Document; tags: Tag[] }
  | { kind: 'tag'; tag: Tag; documentCount: number };

export type MentionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'document'; text: string; document: Document }
  | { kind: 'tag'; text: string; tag: Tag };

export function mentionTargetName(target: MentionTarget): string {
  return target.kind === 'document' ? target.document.name : target.tag.name;
}

export function mentionTargetId(target: MentionTarget): string {
  return target.kind === 'document' ? target.document.id : target.tag.id;
}

// Where a mention leads: the Document, or the Documents list filtered by
// the Tag.
export function mentionHref(roomId: string, segment: Exclude<MentionSegment, { kind: 'text' }>): string {
  return segment.kind === 'document'
    ? `/rooms/${roomId}/documents/${segment.document.id}`
    : documentsWithTagsHref(roomId, [segment.tag.id]);
}

export function documentsWithTagsHref(roomId: string, tagIds: string[]): string {
  const params = new URLSearchParams(tagIds.map((id) => ['tag', id]));
  const query = params.toString();
  return `/rooms/${roomId}/documents${query ? `?${query}` : ''}`;
}

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

// True when the query is an existing name followed by more prose, e.g.
// `Castle Drakon is dark`: that `#` is already a finished mention, so no
// suggestions (and no "create") should pop up while writing after it.
export function isFinishedMention(query: string, names: string[]): boolean {
  return names.some(
    (name) =>
      name !== '' &&
      query.length > name.length &&
      !WORD_CHAR.test(query[name.length]) &&
      query.slice(0, name.length).localeCompare(name, undefined, { sensitivity: 'accent' }) === 0,
  );
}

// 0 = name starts with the query, 1 = a word of it does, 2 = contains it.
function nameRank(name: string, query: string): number | null {
  const normalized = normalizeForSearch(name);
  if (normalized.startsWith(query)) return 0;
  if (normalized.split(/\s+/).some((word) => word.startsWith(query))) return 1;
  if (normalized.includes(query)) return 2;
  return null;
}

// Documents match by name, or (ranked lower) by one of their Tags.
function documentRank(document: Document, documentTags: Tag[], query: string): number | null {
  const byName = nameRank(document.name, query);
  if (byName !== null) return byName;
  const byTag = documentTags
    .map((tag) => nameRank(tag.name, query))
    .filter((rank): rank is number => rank !== null);
  return byTag.length > 0 ? 3 + Math.min(...byTag) : null;
}

// Documents and Tags matching the query, best matches first; on a tie a
// Document comes before a Tag, then alphabetical.
export function filterMentionCandidates(
  documents: Document[],
  tags: Tag[],
  query: string,
  limit = MAX_MENTION_SUGGESTIONS,
): MentionTarget[] {
  const normalizedQuery = normalizeForSearch(query);
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const ranked: { target: MentionTarget; rank: number | null }[] = [
    ...documents.map((document) => {
      const documentTags = document.tagIds.flatMap((id) => tagsById.get(id) ?? []);
      return {
        target: { kind: 'document' as const, document, tags: documentTags },
        rank: documentRank(document, documentTags, normalizedQuery),
      };
    }),
    ...tags.map((tag) => ({
      target: {
        kind: 'tag' as const,
        tag,
        documentCount: documents.filter((document) => document.tagIds.includes(tag.id)).length,
      },
      rank: nameRank(tag.name, normalizedQuery),
    })),
  ];

  return ranked
    .filter((entry): entry is { target: MentionTarget; rank: number } => entry.rank !== null)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (a.target.kind === b.target.kind ? 0 : a.target.kind === 'document' ? -1 : 1) ||
        mentionTargetName(a.target).localeCompare(mentionTargetName(b.target), 'it', {
          sensitivity: 'base',
        }),
    )
    .slice(0, limit)
    .map((entry) => entry.target);
}

// Replaces the `#query` being typed with `#Name`, followed by a space
// unless one is already there. Returns the new text and caret.
export function insertMention(
  text: string,
  mention: MentionQuery,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const after = text.slice(caret);
  const inserted = `${MENTION_PREFIX}${name}${/^\s/.test(after) ? '' : ' '}`;
  return {
    text: text.slice(0, mention.start) + inserted + after,
    caret: mention.start + inserted.length,
  };
}

// Splits text into plain runs and mentions of the given Documents and Tags.
// At each `#` the longest matching name wins, compared ignoring case; a
// Document wins over a Tag with the same name.
export function splitMentions(text: string, documents: Document[], tags: Tag[] = []): MentionSegment[] {
  const byLongestName = [
    ...documents.map((document) => ({ name: document.name, document, tag: null })),
    ...tags.map((tag) => ({ name: tag.name, document: null, tag })),
  ]
    .filter((entry) => entry.name.trim() !== '')
    // Stable, so Documents stay ahead of Tags of the same length.
    .toSorted((a, b) => b.name.length - a.name.length);
  const segments: MentionSegment[] = [];
  let plainStart = 0;
  let index = text.indexOf(MENTION_PREFIX);

  while (index !== -1 && byLongestName.length > 0) {
    const entry = isMentionStart(text, index)
      ? byLongestName.find((candidate) => mentionsAt(text, index + 1, candidate.name))
      : undefined;
    if (entry) {
      const end = index + 1 + entry.name.length;
      if (index > plainStart) {
        segments.push({ kind: 'text', text: text.slice(plainStart, index) });
      }
      const mentionText = text.slice(index, end);
      segments.push(
        entry.document
          ? { kind: 'document', text: mentionText, document: entry.document }
          : { kind: 'tag', text: mentionText, tag: entry.tag! },
      );
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

export interface MentionKeyState {
  candidateCount: number;
  // Nothing matched and the viewer may create a Document or Tag.
  createAvailable: boolean;
  // The "create" row is highlighted (reached with the arrow keys).
  createHighlighted: boolean;
}

export type MentionKeyAction =
  | 'next'
  | 'previous'
  | 'select'
  | 'close'
  | 'highlightCreate'
  | 'unhighlightCreate'
  | 'toggleKind'
  | 'create';

interface KeyInfo {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

// What a key does while the popup is open (null: let it through, so e.g.
// Ctrl+Enter still submits a Comment, and Enter is a newline unless the
// user has moved onto a suggestion or the "create" row).
export function mentionKeyAction(event: KeyInfo, state: MentionKeyState): MentionKeyAction | null {
  if (event.key === 'Escape') {
    return 'close';
  }
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }
  const confirm = (event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey;

  if (state.candidateCount > 0) {
    if (event.key === 'ArrowDown') return 'next';
    if (event.key === 'ArrowUp') return 'previous';
    return confirm ? 'select' : null;
  }
  if (!state.createAvailable) {
    return null;
  }
  if (event.key === 'ArrowDown') return 'highlightCreate';
  if (!state.createHighlighted) return null;
  if (event.key === 'ArrowUp') return 'unhighlightCreate';
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') return 'toggleKind';
  return confirm ? 'create' : null;
}

// Moves the highlighted suggestion, wrapping around at either end.
export function moveActiveIndex(current: number, count: number, direction: 1 | -1): number {
  if (count === 0) {
    return 0;
  }
  return (current + direction + count) % count;
}

// DOM id of a popup option, for `aria-activedescendant`.
export function mentionOptionId(listId: string, index: number | 'create'): string {
  return `${listId}-${index}`;
}

// The kinds the viewer may create from the popup, in switch order.
export function creatableKinds(permissions: { canCreateDocument: boolean; canCreateTag: boolean }): MentionKind[] {
  return [
    ...(permissions.canCreateDocument ? (['document'] as const) : []),
    ...(permissions.canCreateTag ? (['tag'] as const) : []),
  ];
}

// The name for a new Document/Tag made from what was typed after `#`.
export function newEntryName(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}
