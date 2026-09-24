import { describe, expect, it } from 'vitest';
import {
  MAX_DISPLAY_NAME_LENGTH,
  profileFormValues,
  toProfilePatch,
  toUserIdentity,
  tooLong,
} from './profile';
import type { AccountProfile } from '../types/profile';
import { setLanguage } from '../i18n';

const profile: AccountProfile = {
  userId: 'u-1',
  email: 'me@example.com',
  displayName: null,
  pronouns: 'they/them',
  bio: null,
  avatarUrl: 'https://cdn.example.com/a.webp',
};

describe('profile form', () => {
  it('starts from the saved profile, with blanks for unset fields', () => {
    expect(profileFormValues(profile)).toEqual({ displayName: '', pronouns: 'they/them', bio: '' });
  });

  it('trims values and sends blanks as null so they are cleared', () => {
    expect(toProfilePatch({ displayName: '  Van Richten ', pronouns: '   ', bio: '' })).toEqual({
      display_name: 'Van Richten',
      pronouns: null,
      bio: null,
    });
  });

  it('checks the length limit after trimming', () => {
    const validate = tooLong(MAX_DISPLAY_NAME_LENGTH);
    expect(validate(`  ${'a'.repeat(MAX_DISPLAY_NAME_LENGTH)}  `)).toBeNull();
    expect(validate('a'.repeat(MAX_DISPLAY_NAME_LENGTH + 1))).toContain(
      String(MAX_DISPLAY_NAME_LENGTH),
    );
  });

  it('reports the limit in the UI language', async () => {
    const validate = tooLong(40);
    expect(validate('a'.repeat(41))).toBe('Massimo 40 caratteri');

    await setLanguage('en');

    expect(validate('a'.repeat(41))).toBe('At most 40 characters');
  });
});

describe('toUserIdentity', () => {
  it('maps the API fields', () => {
    expect(
      toUserIdentity({
        email: 'me@example.com',
        display_name: 'Ezmerelda',
        pronouns: null,
        bio: 'Hunter',
        avatar_url: null,
      }),
    ).toEqual({
      email: 'me@example.com',
      displayName: 'Ezmerelda',
      pronouns: null,
      bio: 'Hunter',
      avatarUrl: null,
    });
  });
});
