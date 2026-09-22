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

// Label for a picker option (Owner, Selective grant). Two members with no
// email would otherwise share the same label, so the fallback carries a short
// piece of the user id to tell them apart and avoid picking the wrong one.
export function memberOptionLabel(member: Member): string {
  return member.email ?? `${UNKNOWN_USER_LABEL} (${member.userId.slice(0, 8)})`;
}
