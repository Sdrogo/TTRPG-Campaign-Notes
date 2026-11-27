import type { ColorPalette } from '../lib/palette';

/**
 * How a user is shown to others: every response that names a user carries these
 * fields (backend app/api/profiles.py). All optional. `email` is set only on
 * the signed-in user's own profile, never on another user's (NFR-03).
 */
export interface UserIdentity {
  email: string | null;
  displayName: string | null;
  pronouns: string | null;
  bio: string | null;
  avatarUrl: string | null;
}

/** The signed-in user's own profile, as the Account page edits it. */
export interface AccountProfile extends UserIdentity {
  userId: string;
  /** May open the Admin page (ticket 75); not the Room Administrator role. */
  appAdmin?: boolean;
  /** The map palette this user sees (spec 78); 'standard' when none was picked. */
  colorPalette?: ColorPalette;
}

/** The Account page form's values. Blank strings stand for unset fields (see `toProfilePatch`). */
export interface ProfileFormValues {
  displayName: string;
  pronouns: string;
  bio: string;
}

/** The PATCH /account body: `null` clears a field. */
export interface ProfilePatch {
  display_name: string | null;
  pronouns: string | null;
  bio: string | null;
}

/** The profile fields as the API sends them (snake_case). */
export interface RawUserIdentity {
  email: string | null;
  display_name: string | null;
  pronouns: string | null;
  bio: string | null;
  avatar_url: string | null;
}
