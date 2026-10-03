import { describe, expect, it } from 'vitest';
import {
  applyDisplayEdit,
  filterMemberCandidates,
  mentionToken,
  replaceDisplayRange,
  resolveUserMention,
  splitMentionTokens,
  toDisplay,
  userMentionToken,
  type UserMention,
} from '../../lib/mentionTokens';
import type { Member } from '../../types/member';

// Member tokens are read only where members can be mentioned (Comments).
const USERS = { users: true };
const splitUsers = (text: string) => splitMentionTokens(text, USERS);
const showUsers = (text: string) => toDisplay(text, USERS);
const replaceUsers = (stored: string, from: number, to: number, inserted: string) =>
  replaceDisplayRange(stored, from, to, inserted, USERS);
const applyUsers = (stored: string, display: string, caret = 0) =>
  applyDisplayEdit(stored, display, caret, USERS);

const ARA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';
const GONE = '33333333-3333-4333-8333-333333333333';

function member(userId: string, displayName: string | null, email: string | null = null): Member {
  return {
    userId,
    role: 'player',
    isAdmin: false,
    email,
    displayName,
    pronouns: null,
    bio: null,
    avatarUrl: null,
  };
}

const members = [member(ARA, 'Ara'), member(BRUNO, 'Bruno Rossi')];

const ara = `@[Ara](user:${ARA})`;

describe('userMentionToken', () => {
  it('writes the token, escaping ] and \\ in the name', () => {
    expect(userMentionToken(ARA, 'Ara')).toBe(ara);
    expect(userMentionToken(ARA, 'a]b\\c[d')).toBe(`@[a\\]b\\\\c[d](user:${ARA})`);
  });
});

describe('splitMentionTokens', () => {
  it('splits plain runs and member mentions, keeping the stored text', () => {
    const text = `Ciao ${ara}, guarda qui`;
    const segments = splitUsers(text);

    expect(segments).toEqual([
      { kind: 'text', stored: 'Ciao ', display: 'Ciao ' },
      { kind: 'user', stored: ara, display: '@Ara', targetId: ARA, name: 'Ara' },
      { kind: 'text', stored: ', guarda qui', display: ', guarda qui' },
    ]);
    expect(segments.map((segment) => segment.stored).join('')).toBe(text);
  });

  it('reads escaped names and back-to-back tokens', () => {
    const escaped = userMentionToken(BRUNO, 'B]r\\x');

    expect(showUsers(`${escaped}${ara}`)).toBe('@B]r\\x@Ara');
  });

  it('reads an upper-case id as the same user', () => {
    const [segment] = splitUsers(`@[Ara](user:${ARA.toUpperCase()})`);

    expect(segment).toMatchObject({ kind: 'user', targetId: ARA });
  });

  it('leaves whatever is not a whole member token as plain text', () => {
    for (const text of [
      '',
      'email@[x]',
      `@[Ara](doc:${ARA})`,
      `#[Ara](user:${ARA})`,
      '@[Ara](user:not-a-uuid)',
      '@[never closed',
      `@[Ara] (user:${ARA})`,
      'trailing \\',
    ]) {
      expect(showUsers(text)).toBe(text);
    }
  });

  it('skips a broken opening and still finds the token after it', () => {
    expect(showUsers(`@[rotto] ${ara}`)).toBe('@[rotto] @Ara');
  });

  it('reads a name up to the first unescaped ], like the backend', () => {
    // `[` isn't escaped, so an earlier `@[` swallows the token after it.
    expect(showUsers(`@[ciao ${ara}`)).toBe('@ciao @[Ara');
  });
});

describe('Document and Tag tokens (spec 20)', () => {
  const DOC = '44444444-4444-4444-8444-444444444444';
  const castle = `#[Castle](doc:${DOC})`;

  it('writes a token for each kind', () => {
    expect(mentionToken('doc', DOC, 'Castle')).toBe(castle);
    expect(mentionToken('tag', DOC, 'P]NG')).toBe(`#[P\\]NG](tag:${DOC})`);
  });

  it('reads them in any text, member tokens only when asked', () => {
    const text = `${castle} e ${ara}`;

    expect(toDisplay(text)).toBe(`#Castle e ${ara}`);
    expect(toDisplay(text, USERS)).toBe('#Castle e @Ara');
    expect(splitMentionTokens(`#[PNG](tag:${DOC})`)).toEqual([
      { kind: 'tag', stored: `#[PNG](tag:${DOC})`, display: '#PNG', targetId: DOC, name: 'PNG' },
    ]);
  });

  it('edits around them and unlinks one whose name is edited', () => {
    expect(applyDisplayEdit(`${castle} ciao`, '#Castle ciao!')).toBe(`${castle} ciao!`);
    expect(applyDisplayEdit(`${castle} ciao`, '#Castl ciao')).toBe('#Castl ciao');
    expect(replaceDisplayRange(castle, 7, 7, '!')).toBe(`${castle}!`);
  });
});

describe('replaceDisplayRange', () => {
  it('keeps tokens on either side of the range', () => {
    const stored = `${ara} e ${ara}`;
    // Shown as "@Ara e @Ara": replace " e " (4 to 7).
    expect(replaceUsers(stored, 4, 7, ' o ')).toBe(`${ara} o ${ara}`);
  });

  it('inserts right after or right before a token without touching it', () => {
    expect(replaceUsers(ara, 4, 4, '!')).toBe(`${ara}!`);
    expect(replaceUsers(ara, 0, 0, '>')).toBe(`>${ara}`);
  });

  it('turns a token the range cuts into plain text', () => {
    // Deleting the last letter of "@Ara".
    expect(replaceUsers(`${ara} ciao`, 3, 4, '')).toBe('@Ar ciao');
    // Typing inside the name.
    expect(replaceUsers(ara, 2, 2, 'x')).toBe('@Axra');
  });

  it('writes the inserted text as is, so it may be a token', () => {
    expect(replaceUsers('Ciao @Ar', 5, 8, `${ara} `)).toBe(`Ciao ${ara} `);
  });
});

describe('applyDisplayEdit', () => {
  it('returns the stored text when nothing changed', () => {
    expect(applyUsers(ara, '@Ara')).toBe(ara);
  });

  it('applies typing around tokens', () => {
    expect(applyUsers(`${ara} ciao`, '@Ara ciao!')).toBe(`${ara} ciao!`);
    expect(applyUsers(`${ara} ciao`, 'Ehi @Ara ciao')).toBe(`Ehi ${ara} ciao`);
  });

  it('unlinks a mention whose name is edited', () => {
    expect(applyUsers(`${ara} ciao`, '@Ar ciao')).toBe('@Ar ciao');
  });

  it('handles a repeated character at the edit point', () => {
    // "aa" -> "aaa": the common start and end must not overlap.
    expect(applyUsers('aa', 'aaa')).toBe('aaa');
    expect(applyUsers('aaa', 'aa')).toBe('aa');
  });

  it('uses the caret to place an ambiguous edit', () => {
    // "@Ara" -> "@@Ara": the new "@" went in before the mention, not inside it.
    expect(applyUsers(ara, '@@Ara', 1)).toBe(`@${ara}`);
    // Deleting the first of two spaces before a mention keeps it too.
    expect(applyUsers(`x  ${ara}`, 'x @Ara', 1)).toBe(`x ${ara}`);
  });

  it('handles clearing the whole text', () => {
    expect(applyUsers(`${ara} ciao`, '')).toBe('');
  });
});

describe('resolveUserMention', () => {
  const mention = (userId: string, name: string): UserMention => ({
    kind: 'user',
    stored: userMentionToken(userId, name),
    display: `@${name}`,
    targetId: userId,
    name,
  });

  it('shows a member under their current name', () => {
    expect(resolveUserMention(mention(BRUNO, 'Bruno'), members)).toEqual({
      text: '@Bruno Rossi',
      member: true,
    });
  });

  it('shows someone no longer in the Room as written, not highlighted', () => {
    expect(resolveUserMention(mention(GONE, 'Carla'), members)).toEqual({
      text: '@Carla',
      member: false,
    });
  });
});

describe('filterMemberCandidates', () => {
  const people = [
    member(BRUNO, 'Bruno Rossi'),
    member(ARA, 'Ara'),
    member(GONE, null, 'abruzzo@example.com'),
  ];

  it('matches the shown name, ignoring case and accents, best first', () => {
    expect(filterMemberCandidates(people, 'br').map((m) => m.userId)).toEqual([BRUNO, GONE]);
    expect(filterMemberCandidates(people, 'ROSSI').map((m) => m.userId)).toEqual([BRUNO]);
  });

  it('lists everyone alphabetically for an empty query, up to the limit', () => {
    expect(filterMemberCandidates(people, '').map((m) => m.userId)).toEqual([GONE, ARA, BRUNO]);
    expect(filterMemberCandidates(people, '', 1)).toHaveLength(1);
  });

  it('matches nobody for an unknown name', () => {
    expect(filterMemberCandidates(people, 'zeta')).toEqual([]);
  });
});
