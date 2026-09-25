import type { Member } from '../types/member';
import type { UserIdentity } from '../types/profile';
import i18n from '../i18n';

/**
 * Shown when the backend has neither a chosen name nor an email for a user (its
 * `users` mirror row is missing), in the current UI language. A raw user id is
 * never shown in its place.
 */
export function unknownUserLabel(): string {
  return i18n.t('common.unknownUser');
}

/**
 * The name to show for a user everywhere (Comments, Owners, members list,
 * account button): the name they chose on the Account page, else their email.
 */
export function userDisplayName(user: UserIdentity | undefined): string {
  return user?.displayName ?? user?.email ?? unknownUserLabel();
}

/** `userDisplayName` for a Room member, or the unknown-user label when they aren't in the list. */
export function memberDisplayName(member: Member | undefined): string {
  return userDisplayName(member);
}

/** The member with this user id, if they're still in the Room. */
export function findMember(members: Member[], userId: string): Member | undefined {
  return members.find((m) => m.userId === userId);
}

/** The name to show for a user id, looked up among the Room's members. */
export function displayNameFor(members: Member[], userId: string): string {
  return memberDisplayName(findMember(members, userId));
}

/**
 * Label for a picker option (Owner, Selective grant), where picking the wrong
 * person gives them access. Chosen names aren't unique, so the email is added
 * next to one; two members with neither get a short piece of the user id to
 * tell them apart.
 */
export function memberOptionLabel(member: Member): string {
  if (member.displayName) {
    return member.email ? `${member.displayName} (${member.email})` : member.displayName;
  }
  return member.email ?? `${unknownUserLabel()} (${member.userId.slice(0, 8)})`;
}
