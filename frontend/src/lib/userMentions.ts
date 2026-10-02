import type { Member } from '../types/member';
import { currentLanguage } from '../i18n';
import { findMember, memberDisplayName } from './members';
import { MAX_MENTION_SUGGESTIONS, nameRank, normalizeForSearch } from './documentMentions';

// @mentions of Room members in Comments (spec 19c Decision 2, FR-T6). A
// mention is stored inline as `@[Name](user:<uuid>)`, the grammar of
// `backend/app/domain/mentions.py`: inside the brackets `\` keeps the next
// character as is (so `\]` and `\\`), and anything that doesn't read as a
// whole token is plain text. The textarea shows `@Name` and never the token
// syntax; `toDisplay` and `replaceDisplayRange` map between the two.

/** The character that starts a member mention. */
export const USER_MENTION_PREFIX = '@';

const UUID =
  /^\(user:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/;

/** A member mention as stored (`stored`) and as the textarea shows it (`display`). */
export interface UserMention {
  kind: 'user';
  stored: string;
  display: string;
  userId: string;
  /** The name written in the token, unescaped. */
  name: string;
}

/** A run of stored text: plain, or a member mention. */
export type UserMentionSegment = { kind: 'text'; stored: string; display: string } | UserMention;

/** The stored token for a mention of `userId` shown as `name`. */
export function userMentionToken(userId: string, name: string): string {
  return `${USER_MENTION_PREFIX}[${name.replace(/[\\\]]/g, '\\$&')}](user:${userId})`;
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

/**
 * `text` split into plain runs and member mentions, in order. Joining every
 * `stored` gives `text` back; joining every `display` gives what the textarea
 * shows. Only the `user` kind is read here: `#` tokens (spec 20) stay text.
 */
export function splitUserMentions(text: string): UserMentionSegment[] {
  const segments: UserMentionSegment[] = [];
  let plainStart = 0;
  let index = text.indexOf(`${USER_MENTION_PREFIX}[`);
  while (index !== -1) {
    const read = readName(text, index + 2);
    const target = read && UUID.exec(text.slice(read.close + 1));
    if (!read || !target) {
      index = text.indexOf(`${USER_MENTION_PREFIX}[`, index + 1);
      continue;
    }
    const end = read.close + 1 + target[0].length;
    if (index > plainStart) {
      const plain = text.slice(plainStart, index);
      segments.push({ kind: 'text', stored: plain, display: plain });
    }
    segments.push({
      kind: 'user',
      stored: text.slice(index, end),
      display: `${USER_MENTION_PREFIX}${read.name}`,
      userId: target[1].toLowerCase(),
      name: read.name,
    });
    plainStart = end;
    index = text.indexOf(`${USER_MENTION_PREFIX}[`, end);
  }
  if (plainStart < text.length) {
    const plain = text.slice(plainStart);
    segments.push({ kind: 'text', stored: plain, display: plain });
  }
  return segments;
}

/** What `stored` reads as: every mention as `@Name`. */
export function toDisplay(stored: string): string {
  return splitUserMentions(stored)
    .map((segment) => segment.display)
    .join('');
}

/**
 * `stored` with the shown characters from `from` to `to` (in `toDisplay`
 * coordinates) replaced by `inserted`, which is written as is (so it may
 * itself be a token). A mention cut by the range is kept only for the part
 * outside it, as plain text: editing a name unlinks it.
 */
export function replaceDisplayRange(
  stored: string,
  from: number,
  to: number,
  inserted: string,
): string {
  let before = '';
  let after = '';
  let position = 0;
  for (const segment of splitUserMentions(stored)) {
    const start = position;
    const end = position + segment.display.length;
    position = end;
    if (end <= from) {
      before += segment.stored;
    } else if (start >= to) {
      after += segment.stored;
    } else {
      // Plain text, or a mention the range cuts: keep only what's outside it.
      before += segment.display.slice(0, Math.max(from - start, 0));
      after += segment.display.slice(Math.max(to - start, 0));
    }
  }
  return before + inserted + after;
}

/**
 * The stored text after the textarea's text went from `toDisplay(stored)` to
 * `display`: the changed run (between the unchanged start and end) replaces
 * the same run of `stored`, and mentions it touches become plain text. Where
 * the change is ambiguous (typing `@` right before `@Ara`), `caret`, the
 * caret after the edit, places it: the unchanged end never starts before it.
 */
export function applyDisplayEdit(stored: string, display: string, caret = 0): string {
  const previous = toDisplay(stored);
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
  );
}

/** How a member mention renders: highlighted while they're a member, else as written. */
export function resolveUserMention(
  segment: UserMention,
  members: Member[],
): { text: string; member: boolean } {
  const member = findMember(members, segment.userId);
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
