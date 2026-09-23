import type {
  AccountProfile,
  ProfileFormValues,
  ProfilePatch,
  RawUserIdentity,
  UserIdentity,
} from '../types/profile';

/** Mirrors app/domain/profiles.py; the backend re-checks it. */
export const MAX_DISPLAY_NAME_LENGTH = 60;
/** Mirrors app/domain/profiles.py; the backend re-checks it. */
export const MAX_PRONOUNS_LENGTH = 40;
/** Mirrors app/domain/profiles.py; the backend re-checks it. */
export const MAX_BIO_LENGTH = 1000;

/** Converts the API's snake_case profile fields, the one place they are read. */
export function toUserIdentity(raw: RawUserIdentity): UserIdentity {
  return {
    email: raw.email,
    displayName: raw.display_name,
    pronouns: raw.pronouns,
    bio: raw.bio,
    avatarUrl: raw.avatar_url,
  };
}

/** The Account form's starting values: unset fields become empty strings. */
export function profileFormValues(profile: AccountProfile): ProfileFormValues {
  return {
    displayName: profile.displayName ?? '',
    pronouns: profile.pronouns ?? '',
    bio: profile.bio ?? '',
  };
}

const blankToNull = (value: string): string | null => value.trim() || null;

/** Blank fields are sent as `null`, which clears them on the backend. */
export function toProfilePatch(values: ProfileFormValues): ProfilePatch {
  return {
    display_name: blankToNull(values.displayName),
    pronouns: blankToNull(values.pronouns),
    bio: blankToNull(values.bio),
  };
}

/**
 * Mantine form validator: an error message, or null when within the limit.
 * Counted after trimming, like the backend.
 */
export function tooLong(max: number) {
  return (value: string): string | null =>
    value.trim().length > max ? `Massimo ${max} caratteri` : null;
}
