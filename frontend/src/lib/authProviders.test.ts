import { describe, expect, it } from 'vitest';
import { AUTH_PROVIDERS, authProviderOf } from './authProviders';

describe('AUTH_PROVIDERS', () => {
  // These are the providers enabled in the Supabase dashboard (spec 08).
  it('lists every provider enabled in Supabase, Google first', () => {
    expect(AUTH_PROVIDERS.map((provider) => provider.id)).toEqual([
      'google',
      'discord',
      'facebook',
      'github',
      'x',
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
    expect(authProviderOf('x')?.label).toBe('X');
  });

  it('is undefined for a missing or unknown provider', () => {
    expect(authProviderOf(undefined)).toBeUndefined();
    expect(authProviderOf('twitter')).toBeUndefined();
    expect(authProviderOf(42)).toBeUndefined();
  });
});
