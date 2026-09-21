import type { Member } from '../types/member';

// Shown when the backend has no email for a user (its `users` mirror row is
// missing). A raw user id is never shown in its place.
export const UNKNOWN_USER_LABEL = 'Utente sconosciuto';

export function memberDisplayName(member: Member | undefined): string {
  return member?.email ?? UNKNOWN_USER_LABEL;
}

export function displayNameFor(members: Member[], userId: string): string {
  return memberDisplayName(members.find((m) => m.userId === userId));
}
