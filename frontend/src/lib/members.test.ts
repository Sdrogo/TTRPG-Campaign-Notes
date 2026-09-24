import { describe, expect, it } from 'vitest';
import {
  unknownUserLabel,
  displayNameFor,
  memberDisplayName,
  memberOptionLabel,
  userDisplayName,
} from './members';
import type { Member } from '../types/member';
import { setLanguage } from '../i18n';

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
  it('uses the email when there is no chosen name', () => {
    expect(memberOptionLabel(member('11111111-aaaa', 'a@example.com'))).toBe('a@example.com');
  });

  it('adds the email to a chosen name, since names are not unique', () => {
    const first = memberOptionLabel(member('u-1', 'a@example.com', 'Ismark'));
    const second = memberOptionLabel(member('u-2', 'b@example.com', 'Ismark'));
    expect(first).toBe('Ismark (a@example.com)');
    expect(first).not.toBe(second);
  });

  it('shows just the chosen name when there is no email', () => {
    expect(memberOptionLabel(member('u-1', null, 'Ismark'))).toBe('Ismark');
  });

  it('tells apart two members with neither', () => {
    const first = memberOptionLabel(member('11111111-aaaa', null));
    const second = memberOptionLabel(member('22222222-bbbb', null));
    expect(first).not.toBe(second);
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
