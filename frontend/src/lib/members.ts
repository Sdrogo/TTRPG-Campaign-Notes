import type { Member } from '../types/member';
import type { UserIdentity } from '../types/profile';

// Shown when the backend has neither a chosen name nor an email for a user
// (its `users` mirror row is missing). A raw user id is never shown in its
// place.
export const UNKNOWN_USER_LABEL = 'Utente sconosciuto';

// The name to show for a user everywhere (Comments, Owners, members list,
// account button): the name they chose on the Account page, else their email.
export function userDisplayName(user: UserIdentity | undefined): string {
  return user?.displayName ?? user?.email ?? UNKNOWN_USER_LABEL;
}

export function memberDisplayName(member: Member | undefined): string {
  return userDisplayName(member);
}

export function findMember(members: Member[], userId: string): Member | undefined {
  return members.find((m) => m.userId === userId);
}

export function displayNameFor(members: Member[], userId: string): string {
  return memberDisplayName(findMember(members, userId));
}

// Label for a picker option (Owner, Selective grant), where picking the
// wrong person gives them access. Chosen names aren't unique, so the email
// is added next to one; two members with neither get a short piece of the
// user id to tell them apart.
export function memberOptionLabel(member: Member): string {
  if (member.displayName) {
    return member.email ? `${member.displayName} (${member.email})` : member.displayName;
  }
  return member.email ?? `${UNKNOWN_USER_LABEL} (${member.userId.slice(0, 8)})`;
}
