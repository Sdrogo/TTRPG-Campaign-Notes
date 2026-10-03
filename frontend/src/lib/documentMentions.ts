import type { Document } from '../types/document';
import type { Tag } from '../types/tag';
import type { Member } from '../types/member';
import { memberDisplayName } from './members';
import { currentLanguage } from '../i18n';
import type { MentionToken } from './mentionTokens';

// Mentions (FR-D4, specs `06 - Quick navigation`, `06_1 - … refnment` and
// `20 - Mention backlinks`): typing `#` at the start of a word suggests the
// Room's Documents and Tags; picking one stores a token with its id
// (`#[Name](doc:<uuid>)`, see `mentionTokens.ts`), shown as `#Name` and
// rendered as a link (to the Document, or to the Documents with that Tag)
// under its current name. A token is resolved against what the viewer can
// see, so a mention of a hidden or deleted Document reads as plain text with
// the name it was written with. Plain `#Name` text from before spec 20 still
// resolves by name (`splitMentions`). In Comments, `@` suggests the Room's
// members the same way (spec 19c).

/** The character that starts a mention. */
export const MENTION_PREFIX = '#';
/** How many suggestions the popup shows at most. */
export const MAX_MENTION_SUGGESTIONS = 8;
// Past this length a `#…` run is prose, not a mention being typed.
const MAX_QUERY_LENGTH = 80;

// A `#` counts as a mention start at the beginning of the text, after
// whitespace, or after an opening bracket.
const MENTION_BOUNDARY = /[\s([{]/;
// A mention must end on a word boundary: `#Rome` doesn't match `#Romeo`.
const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** A mention being typed: where its `#` is and what follows it so far. */
export interface MentionQuery {
  /** Index of the `#` in the text. */
  start: number;
  /** What was typed after the `#`, up to the caret. */
  query: string;
}

/** What a mention can point at. */
export type MentionKind = 'document' | 'tag';

/**
 * A suggestion in the popup: a Document with its Tags, a Tag with how many
 * visible Documents carry it, or a Room member.
 */
export type MentionTarget =
  | { kind: 'document'; document: Document; tags: Tag[] }
  | { kind: 'tag'; tag: Tag; documentCount: number }
  | { kind: 'member'; member: Member };

/**
 * A run of text as `splitMentions` returns it: plain, or a mention resolved to
 * the Document or Tag it names.
 */
export type MentionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'document'; text: string; document: Document }
  | { kind: 'tag'; text: string; tag: Tag };

/** The name a suggestion is shown and inserted by. */
export function mentionTargetName(target: MentionTarget): string {
  switch (target.kind) {
    case 'document':
      return target.document.name;
    case 'tag':
      return target.tag.name;
    case 'member':
      return memberDisplayName(target.member);
  }
}

/** A suggestion's id, unique within its kind. */
export function mentionTargetId(target: MentionTarget): string {
  switch (target.kind) {
    case 'document':
      return target.document.id;
    case 'tag':
      return target.tag.id;
    case 'member':
      return target.member.userId;
  }
}

/** Where a mention leads: the Document, or the Documents list filtered by the Tag. */
export function mentionHref(roomId: string, segment: Exclude<MentionSegment, { kind: 'text' }>): string {
  return segment.kind === 'document'
    ? `/rooms/${roomId}/documents/${segment.document.id}`
    : documentsWithTagsHref(roomId, [segment.tag.id]);
}

/**
 * The Documents page filtered to the Documents carrying all of `tagIds`
 * (FR-N2), or unfiltered for none.
 */
export function documentsWithTagsHref(roomId: string, tagIds: string[]): string {
  const params = new URLSearchParams(tagIds.map((id) => ['tag', id]));
  const query = params.toString();
  return `/rooms/${roomId}/documents${query ? `?${query}` : ''}`;
}

function isMentionStart(text: string, index: number, prefixes: string): boolean {
  return prefixes.includes(text[index]) && (index === 0 || MENTION_BOUNDARY.test(text[index - 1]));
}

/** Lowercase and without accents, so "citta" finds "Città". */
export function normalizeForSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

/**
 * The mention being typed at the caret, if any, started by one of the
 * `prefixes` characters (`#` by default; `#@` in Comments).
 */
export function findMentionQuery(text: string, caret: number, prefixes = MENTION_PREFIX): MentionQuery | null {
  const before = text.slice(0, caret);
  const start = Math.max(-1, ...[...prefixes].map((prefix) => before.lastIndexOf(prefix)));
  if (start === -1 || !isMentionStart(before, start, prefixes)) {
    return null;
  }
  const query = before.slice(start + 1);
  if (query.length > MAX_QUERY_LENGTH || query.includes('\n') || /^\s/.test(query)) {
    return null;
  }
  return { start, query };
}

/**
 * True when the query is an existing name followed by more prose, e.g. `Castle
 * Drakon is dark`: that `#` is already a finished mention, so no suggestions
 * (and no "create") should pop up while writing after it.
 */
export function isFinishedMention(query: string, names: string[]): boolean {
  return names.some(
    (name) =>
      name !== '' &&
      query.length > name.length &&
      !WORD_CHAR.test(query[name.length]) &&
      query.slice(0, name.length).localeCompare(name, undefined, { sensitivity: 'accent' }) === 0,
  );
}

/**
 * How well a name matches a normalized query: 0 = it starts with it, 1 = a
 * word of it does, 2 = it contains it, null = no match.
 */
export function nameRank(name: string, query: string): number | null {
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

/**
 * Tie-break for two equally-ranked suggestions: a Document before a Tag,
 * then alphabetically within the same kind. Exported as its own function
 * (rather than inlined into `.sort()`) so every branch can be tested
 * directly - `Array.prototype.sort`'s own comparator call order is
 * implementation-defined and not a reliable way to exercise all of them.
 */
export function compareRankedMentions(
  a: { target: MentionTarget; rank: number },
  b: { target: MentionTarget; rank: number },
): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.target.kind !== b.target.kind) return a.target.kind === 'document' ? -1 : 1;
  return mentionTargetName(a.target).localeCompare(mentionTargetName(b.target), currentLanguage(), {
    sensitivity: 'base',
  });
}

/**
 * Documents and Tags matching the query, best matches first; on a tie a
 * Document comes before a Tag, then alphabetical.
 */
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
    .sort(compareRankedMentions)
    .slice(0, limit)
    .map((entry) => entry.target);
}

/**
 * Replaces the `#query` being typed with `#Name` (or `@query` with `@Name`),
 * followed by a space unless one is already there. Returns the new text and
 * caret.
 */
export function insertMention(
  text: string,
  mention: MentionQuery,
  caret: number,
  name: string,
  prefix = MENTION_PREFIX,
): { text: string; caret: number } {
  const after = text.slice(caret);
  const inserted = `${prefix}${name}${/^\s/.test(after) ? '' : ' '}`;
  return {
    text: text.slice(0, mention.start) + inserted + after,
    caret: mention.start + inserted.length,
  };
}

/**
 * Splits text into plain runs and mentions of the given Documents and Tags. At
 * each `#` the longest matching name wins, compared ignoring case; a Document
 * wins over a Tag with the same name.
 */
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
    const entry = isMentionStart(text, index, MENTION_PREFIX)
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

/**
 * How a Document or Tag token renders: a link under the target's current
 * name while the viewer sees it, else plain text with the name it was
 * written with (spec 20 Decisions 5 and 7).
 */
export function resolveContentToken(
  token: MentionToken,
  documents: Document[],
  tags: Tag[],
): MentionSegment {
  const document = token.kind === 'doc' ? documents.find((d) => d.id === token.targetId) : undefined;
  if (document) {
    return { kind: 'document', text: `${MENTION_PREFIX}${document.name}`, document };
  }
  const tag = token.kind === 'tag' ? tags.find((t) => t.id === token.targetId) : undefined;
  return tag
    ? { kind: 'tag', text: `${MENTION_PREFIX}${tag.name}`, tag }
    : { kind: 'text', text: token.display };
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

/** What the popup is showing, which decides what a key does. */
export interface MentionKeyState {
  candidateCount: number;
  /** Nothing matched and the viewer may create a Document or Tag. */
  createAvailable: boolean;
  /** The "create" row is highlighted (reached with the arrow keys). */
  createHighlighted: boolean;
}

/** What a key press does to the popup (see `mentionKeyAction`). */
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

/**
 * What a key does while the popup is open (null: let it through, so e.g.
 * Ctrl+Enter still submits a Comment, and Enter is a newline unless the user
 * has moved onto a suggestion or the "create" row).
 */
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

/** Moves the highlighted suggestion, wrapping around at either end. */
export function moveActiveIndex(current: number, count: number, direction: 1 | -1): number {
  if (count === 0) {
    return 0;
  }
  return (current + direction + count) % count;
}

/** DOM id of a popup option, for `aria-activedescendant`. */
export function mentionOptionId(listId: string, index: number | 'create'): string {
  return `${listId}-${index}`;
}

/** The kinds the viewer may create from the popup, in switch order. */
export function creatableKinds(permissions: { canCreateDocument: boolean; canCreateTag: boolean }): MentionKind[] {
  return [
    ...(permissions.canCreateDocument ? (['document'] as const) : []),
    ...(permissions.canCreateTag ? (['tag'] as const) : []),
  ];
}

/** The name for a new Document/Tag made from what was typed after `#`. */
export function newEntryName(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}
