import type { Provider } from '@supabase/supabase-js';
import {
  DiscordLogoIcon,
  GithubLogoIcon,
  GoogleLogoIcon,
  type Icon,
} from '@phosphor-icons/react';

/** A sign-in provider enabled in Supabase Auth, as the sign-in screen offers it. */
export interface AuthProvider {
  /** Supabase's provider id, passed to `signInWithOAuth`. */
  id: Provider;
  /** The provider's name, as shown to the user. */
  label: string;
  icon: Icon;
}

/**
 * The providers enabled in the Supabase dashboard, in the order the sign-in
 * screen lists them. Adding one here without enabling it there leads to a
 * Supabase error page. Facebook and X were dropped on 2026-10-03 (no app
 * credentials for them).
 */
export const AUTH_PROVIDERS: readonly AuthProvider[] = [
  { id: 'google', label: 'Google', icon: GoogleLogoIcon },
  { id: 'discord', label: 'Discord', icon: DiscordLogoIcon },
  { id: 'github', label: 'GitHub', icon: GithubLogoIcon },
];

/**
 * The provider the session was opened with, from Supabase's
 * `app_metadata.provider`; undefined when it's missing or not one of ours.
 */
export function authProviderOf(providerId: unknown): AuthProvider | undefined {
  return AUTH_PROVIDERS.find((provider) => provider.id === providerId);
}
