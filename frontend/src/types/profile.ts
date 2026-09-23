/**
 * How a user is shown to others: every response that names a user carries these
 * fields (backend app/api/profiles.py). All optional - a user who never opened
 * the Account page is shown by email.
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
