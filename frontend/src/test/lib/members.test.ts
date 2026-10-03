import { describe, expect, it } from 'vitest';
import {
  unknownUserLabel,
  displayNameFor,
  memberDisplayName,
  memberOptionLabel,
  userDisplayName,
} from '../../lib/members';
import type { Member } from '../../types/member';
import { setLanguage } from '../../i18n';

const member = (
  userId: string,
  email: string | null,
  displayName: string | null = null,
): Member => ({
  userId,
  email,
  displayName,
  pronouns: null,
  bio: null,
  avatarUrl: null,
  role: 'player',
  isAdmin: false,
});

describe('memberDisplayName', () => {
  it('prefers the name chosen on the Account page', () => {
    expect(memberDisplayName(member('11111111-aaaa', 'a@example.com', 'Strahd'))).toBe('Strahd');
  });

  it('falls back to the email', () => {
    expect(memberDisplayName(member('11111111-aaaa', 'a@example.com'))).toBe('a@example.com');
  });

  it('never shows a raw id', () => {
    expect(memberDisplayName(member('11111111-aaaa', null))).toBe(unknownUserLabel());
    expect(memberDisplayName(undefined)).toBe(unknownUserLabel());
  });

  it('works for any user identity, not only members', () => {
    expect(
      userDisplayName({
        email: 'me@example.com',
        displayName: null,
        pronouns: null,
        bio: null,
        avatarUrl: null,
      }),
    ).toBe('me@example.com');
  });

  it('looks a member up by id', () => {
    const members = [member('u-1', 'a@example.com', 'Ireena'), member('u-2', 'b@example.com')];
    expect(displayNameFor(members, 'u-1')).toBe('Ireena');
    expect(displayNameFor(members, 'u-2')).toBe('b@example.com');
    expect(displayNameFor(members, 'u-3')).toBe(unknownUserLabel());
  });
});

describe('memberOptionLabel', () => {
  it('shows just the chosen name when no other member shares it', () => {
    const ismark = member('u-1', null, 'Ismark');
    expect(memberOptionLabel(ismark, [ismark, member('u-2', null, 'Ireena')])).toBe('Ismark');
  });

  it('uses the own email when there is no chosen name', () => {
    const me = member('11111111-aaaa', 'a@example.com');
    expect(memberOptionLabel(me, [me])).toBe('a@example.com');
  });

  it('tells apart two members with the same name by a piece of their id', () => {
    const first = member('11111111-aaaa', null, 'Ismark');
    const second = member('22222222-bbbb', null, 'Ismark');
    const members = [first, second];
    expect(memberOptionLabel(first, members)).toBe('Ismark (11111111)');
    expect(memberOptionLabel(second, members)).toBe('Ismark (22222222)');
  });

  it('tells apart two members with neither name nor email', () => {
    const members = [member('11111111-aaaa', null), member('22222222-bbbb', null)];
    const first = memberOptionLabel(members[0], members);
    expect(first).not.toBe(memberOptionLabel(members[1], members));
    expect(first).toContain(unknownUserLabel());
  });
});

describe('unknownUserLabel', () => {
  it('is in the UI language', async () => {
    expect(unknownUserLabel()).toBe('Utente sconosciuto');

    await setLanguage('en');

    expect(unknownUserLabel()).toBe('Unknown user');
    expect(userDisplayName(undefined)).toBe('Unknown user');
  });
});
