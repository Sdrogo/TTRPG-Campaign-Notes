import { describe, expect, it } from 'vitest';
import { AUTH_PROVIDERS, authProviderOf } from '../../lib/authProviders';

describe('AUTH_PROVIDERS', () => {
  // These are the providers the backend signs in with (spec 08, ticket 73).
  it('lists every provider the backend offers, Google first', () => {
    expect(AUTH_PROVIDERS.map((provider) => provider.id)).toEqual([
      'google',
      'discord',
      'github',
    ]);
  });

  it('gives every provider a distinct label', () => {
    const labels = AUTH_PROVIDERS.map((provider) => provider.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('authProviderOf', () => {
  it('finds the provider a session signed in with', () => {
    expect(authProviderOf('github')?.label).toBe('GitHub');
    expect(authProviderOf('discord')?.label).toBe('Discord');
  });

  it('is undefined for a missing or unknown provider', () => {
    expect(authProviderOf(undefined)).toBeUndefined();
    expect(authProviderOf('twitter')).toBeUndefined();
    expect(authProviderOf('facebook')).toBeUndefined();
    expect(authProviderOf('x')).toBeUndefined();
    expect(authProviderOf(42)).toBeUndefined();
  });
});
