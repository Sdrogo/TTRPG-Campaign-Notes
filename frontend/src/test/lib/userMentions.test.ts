import { describe, expect, it } from 'vitest';
import {
  applyDisplayEdit,
  filterMemberCandidates,
  replaceDisplayRange,
  resolveUserMention,
  splitUserMentions,
  toDisplay,
  userMentionToken,
  type UserMention,
} from '../../lib/userMentions';
import type { Member } from '../../types/member';

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

describe('splitUserMentions', () => {
  it('splits plain runs and member mentions, keeping the stored text', () => {
    const text = `Ciao ${ara}, guarda qui`;
    const segments = splitUserMentions(text);

    expect(segments).toEqual([
      { kind: 'text', stored: 'Ciao ', display: 'Ciao ' },
      { kind: 'user', stored: ara, display: '@Ara', userId: ARA, name: 'Ara' },
      { kind: 'text', stored: ', guarda qui', display: ', guarda qui' },
    ]);
    expect(segments.map((segment) => segment.stored).join('')).toBe(text);
  });

  it('reads escaped names and back-to-back tokens', () => {
    const escaped = userMentionToken(BRUNO, 'B]r\\x');

    expect(toDisplay(`${escaped}${ara}`)).toBe('@B]r\\x@Ara');
  });

  it('reads an upper-case id as the same user', () => {
    const [segment] = splitUserMentions(`@[Ara](user:${ARA.toUpperCase()})`);

    expect(segment).toMatchObject({ kind: 'user', userId: ARA });
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
      expect(toDisplay(text)).toBe(text);
    }
  });

  it('skips a broken opening and still finds the token after it', () => {
    expect(toDisplay(`@[rotto] ${ara}`)).toBe('@[rotto] @Ara');
  });

  it('reads a name up to the first unescaped ], like the backend', () => {
    // `[` isn't escaped, so an earlier `@[` swallows the token after it.
    expect(toDisplay(`@[ciao ${ara}`)).toBe('@ciao @[Ara');
  });
});

describe('replaceDisplayRange', () => {
  it('keeps tokens on either side of the range', () => {
    const stored = `${ara} e ${ara}`;
    // Shown as "@Ara e @Ara": replace " e " (4 to 7).
    expect(replaceDisplayRange(stored, 4, 7, ' o ')).toBe(`${ara} o ${ara}`);
  });

  it('inserts right after or right before a token without touching it', () => {
    expect(replaceDisplayRange(ara, 4, 4, '!')).toBe(`${ara}!`);
    expect(replaceDisplayRange(ara, 0, 0, '>')).toBe(`>${ara}`);
  });

  it('turns a token the range cuts into plain text', () => {
    // Deleting the last letter of "@Ara".
    expect(replaceDisplayRange(`${ara} ciao`, 3, 4, '')).toBe('@Ar ciao');
    // Typing inside the name.
    expect(replaceDisplayRange(ara, 2, 2, 'x')).toBe('@Axra');
  });

  it('writes the inserted text as is, so it may be a token', () => {
    expect(replaceDisplayRange('Ciao @Ar', 5, 8, `${ara} `)).toBe(`Ciao ${ara} `);
  });
});

describe('applyDisplayEdit', () => {
  it('returns the stored text when nothing changed', () => {
    expect(applyDisplayEdit(ara, '@Ara')).toBe(ara);
  });

  it('applies typing around tokens', () => {
    expect(applyDisplayEdit(`${ara} ciao`, '@Ara ciao!')).toBe(`${ara} ciao!`);
    expect(applyDisplayEdit(`${ara} ciao`, 'Ehi @Ara ciao')).toBe(`Ehi ${ara} ciao`);
  });

  it('unlinks a mention whose name is edited', () => {
    expect(applyDisplayEdit(`${ara} ciao`, '@Ar ciao')).toBe('@Ar ciao');
  });

  it('handles a repeated character at the edit point', () => {
    // "aa" -> "aaa": the common start and end must not overlap.
    expect(applyDisplayEdit('aa', 'aaa')).toBe('aaa');
    expect(applyDisplayEdit('aaa', 'aa')).toBe('aa');
  });

  it('uses the caret to place an ambiguous edit', () => {
    // "@Ara" -> "@@Ara": the new "@" went in before the mention, not inside it.
    expect(applyDisplayEdit(ara, '@@Ara', 1)).toBe(`@${ara}`);
    // Deleting the first of two spaces before a mention keeps it too.
    expect(applyDisplayEdit(`x  ${ara}`, 'x @Ara', 1)).toBe(`x ${ara}`);
  });

  it('handles clearing the whole text', () => {
    expect(applyDisplayEdit(`${ara} ciao`, '')).toBe('');
  });
});

describe('resolveUserMention', () => {
  const mention = (userId: string, name: string): UserMention => ({
    kind: 'user',
    stored: userMentionToken(userId, name),
    display: `@${name}`,
    userId,
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
