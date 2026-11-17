import {
  DiscordLogoIcon,
  GithubLogoIcon,
  GoogleLogoIcon,
  type Icon,
} from '@phosphor-icons/react';

/** A sign-in provider the backend offers (`/auth/{id}/start`), as the sign-in screen shows it. */
export interface AuthProvider {
  /** The backend's provider id, the `{provider}` of `/auth/{provider}/start`. */
  id: 'google' | 'discord' | 'github';
  /** The provider's name, as shown to the user. */
  label: string;
  icon: Icon;
}

/**
 * The providers the backend signs in with (`app/auth/providers.py`), in the
 * order the sign-in screen lists them. Adding one here without it there
 * leads to a 404. Facebook and X were dropped on 2026-10-03 (no app
 * credentials for them).
 */
export const AUTH_PROVIDERS: readonly AuthProvider[] = [
  { id: 'google', label: 'Google', icon: GoogleLogoIcon },
  { id: 'discord', label: 'Discord', icon: DiscordLogoIcon },
  { id: 'github', label: 'GitHub', icon: GithubLogoIcon },
];

/**
 * The provider the session was opened with, from the session's
 * `user.provider`; undefined when it's missing or not one of ours.
 */
export function authProviderOf(providerId: unknown): AuthProvider | undefined {
  return AUTH_PROVIDERS.find((provider) => provider.id === providerId);
}
