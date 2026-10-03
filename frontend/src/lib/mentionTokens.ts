import type { Member } from '../types/member';
import { currentLanguage } from '../i18n';
import { findMember, memberDisplayName } from './members';
import { MAX_MENTION_SUGGESTIONS, nameRank, normalizeForSearch } from './documentMentions';

// Mention tokens (spec 19c Decision 2, spec 20 Decision 1). A mention is
// stored inline as `<sigil>[Name](<kind>:<uuid>)`, the grammar of
// `backend/app/domain/mentions.py`: `@[Name](user:…)` for a Room member (in
// Comments), `#[Name](doc:…)` for a Document and `#[Name](tag:…)` for a Tag.
// The name is the one shown when it was written; inside the brackets `\`
// keeps the next character as is (so `\]` and `\\`), and anything that
// doesn't read as a whole token is plain text. A textarea shows `@Name` /
// `#Name` and never the token syntax; `toDisplay` and `replaceDisplayRange`
// map between the two.

/** The character that starts a member mention. */
export const USER_MENTION_PREFIX = '@';

/** What a token points at, as written after its `(`. */
export type TokenKind = 'user' | 'doc' | 'tag';

const SIGILS: Record<TokenKind, string> = { user: USER_MENTION_PREFIX, doc: '#', tag: '#' };

const TARGET =
  /^\((user|doc|tag):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/;

/** A token as stored (`stored`) and as a textarea shows it (`display`). */
export interface MentionToken {
  kind: TokenKind;
  stored: string;
  display: string;
  /** The member, Document or Tag it points at, lowercase. */
  targetId: string;
  /** The name written in the token, unescaped. */
  name: string;
}

/** A member mention. */
export type UserMention = MentionToken & { kind: 'user' };

/** A run of stored text: plain, or a token. */
export type TokenSegment = { kind: 'text'; stored: string; display: string } | MentionToken;

/**
 * Which tokens to read. Member tokens only where members can be mentioned
 * (Comments), so other free text is never read as one.
 */
export interface TokenOptions {
  users?: boolean;
}

/** The stored token for a mention of `targetId` shown as `name`. */
export function mentionToken(kind: TokenKind, targetId: string, name: string): string {
  return `${SIGILS[kind]}[${name.replace(/[\\\]]/g, '\\$&')}](${kind}:${targetId})`;
}

/** The stored token for a mention of `userId` shown as `name`. */
export function userMentionToken(userId: string, name: string): string {
  return mentionToken('user', userId, name);
}

// The unescaped name from `start` (just past the `[`) and the index of its
// closing `]`, or null when it is never closed.
function readName(text: string, start: number): { name: string; close: number } | null {
  let name = '';
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\' && index + 1 < text.length) {
      name += text[index + 1];
      index += 2;
    } else if (char === ']') {
      return { name, close: index };
    } else {
      name += char;
      index += 1;
    }
  }
  return null;
}

// The token starting at `index`, if one does.
function readToken(text: string, index: number, options: TokenOptions): MentionToken | null {
  const sigil = text[index];
  if ((sigil !== '#' && sigil !== USER_MENTION_PREFIX) || text[index + 1] !== '[') {
    return null;
  }
  const read = readName(text, index + 2);
  const target = read && TARGET.exec(text.slice(read.close + 1));
  if (!read || !target) {
    return null;
  }
  const kind = target[1] as TokenKind;
  if (SIGILS[kind] !== sigil || (kind === 'user' && !options.users)) {
    return null;
  }
  return {
    kind,
    stored: text.slice(index, read.close + 1 + target[0].length),
    display: `${sigil}${read.name}`,
    targetId: target[2].toLowerCase(),
    name: read.name,
  };
}

/**
 * `text` split into plain runs and tokens, in order. Joining every `stored`
 * gives `text` back; joining every `display` gives what a textarea shows.
 */
export function splitMentionTokens(text: string, options: TokenOptions = {}): TokenSegment[] {
  const segments: TokenSegment[] = [];
  let plainStart = 0;
  let index = 0;
  while (index < text.length) {
    const token = readToken(text, index, options);
    if (!token) {
      index += 1;
      continue;
    }
    if (index > plainStart) {
      const plain = text.slice(plainStart, index);
      segments.push({ kind: 'text', stored: plain, display: plain });
    }
    segments.push(token);
    index += token.stored.length;
    plainStart = index;
  }
  if (plainStart < text.length) {
    const plain = text.slice(plainStart);
    segments.push({ kind: 'text', stored: plain, display: plain });
  }
  return segments;
}

/** What `stored` reads as: every token as `@Name` or `#Name`. */
export function toDisplay(stored: string, options: TokenOptions = {}): string {
  return splitMentionTokens(stored, options)
    .map((segment) => segment.display)
    .join('');
}

/**
 * `stored` with the shown characters from `from` to `to` (in `toDisplay`
 * coordinates) replaced by `inserted`, which is written as is (so it may
 * itself be a token). A token cut by the range is kept only for the part
 * outside it, as plain text: editing a name unlinks it.
 */
export function replaceDisplayRange(
  stored: string,
  from: number,
  to: number,
  inserted: string,
  options: TokenOptions = {},
): string {
  let before = '';
  let after = '';
  let position = 0;
  for (const segment of splitMentionTokens(stored, options)) {
    const start = position;
    const end = position + segment.display.length;
    position = end;
    if (end <= from) {
      before += segment.stored;
    } else if (start >= to) {
      after += segment.stored;
    } else {
      // Plain text, or a token the range cuts: keep only what's outside it.
      before += segment.display.slice(0, Math.max(from - start, 0));
      after += segment.display.slice(Math.max(to - start, 0));
    }
  }
  return before + inserted + after;
}

/**
 * The stored text after the textarea's text went from `toDisplay(stored)` to
 * `display`: the changed run (between the unchanged start and end) replaces
 * the same run of `stored`, and tokens it touches become plain text. Where
 * the change is ambiguous (typing `@` right before `@Ara`), `caret`, the
 * caret after the edit, places it: the unchanged end never starts before it.
 */
export function applyDisplayEdit(
  stored: string,
  display: string,
  caret = 0,
  options: TokenOptions = {},
): string {
  const previous = toDisplay(stored, options);
  if (previous === display) {
    return stored;
  }
  const shortest = Math.min(previous.length, display.length);
  const maxSuffix = Math.min(shortest, display.length - caret);
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    previous[previous.length - 1 - suffix] === display[display.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  let prefix = 0;
  while (prefix < shortest - suffix && previous[prefix] === display[prefix]) {
    prefix += 1;
  }
  return replaceDisplayRange(
    stored,
    prefix,
    previous.length - suffix,
    display.slice(prefix, display.length - suffix),
    options,
  );
}

/** How a member mention renders: highlighted while they're a member, else as written. */
export function resolveUserMention(
  segment: UserMention,
  members: Member[],
): { text: string; member: boolean } {
  const member = findMember(members, segment.targetId);
  return member
    ? { text: `${USER_MENTION_PREFIX}${memberDisplayName(member)}`, member: true }
    : { text: segment.display, member: false };
}

/** Members whose shown name matches the query, best matches first, then alphabetical. */
export function filterMemberCandidates(
  members: Member[],
  query: string,
  limit = MAX_MENTION_SUGGESTIONS,
): Member[] {
  const normalizedQuery = normalizeForSearch(query);
  return members
    .map((member) => ({ member, name: memberDisplayName(member) }))
    .map((entry) => ({ ...entry, rank: nameRank(entry.name, normalizedQuery) }))
    .filter((entry): entry is { member: Member; name: string; rank: number } => entry.rank !== null)
    .sort(
      (a, b) =>
        a.rank - b.rank || a.name.localeCompare(b.name, currentLanguage(), { sensitivity: 'base' }),
    )
    .slice(0, limit)
    .map((entry) => entry.member);
}
