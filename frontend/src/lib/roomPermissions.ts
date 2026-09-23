import type { Member } from '../types/member';
import type { Room } from '../types/room';

// Frontend mirrors of backend rules, so nobody is offered an action that
// would only be rejected. The backend still enforces them.

/** D-13/FR-D7: the Master always can; a Player only if the Room allows it. */
export function canCreateDocuments(member: Member | undefined, room: Room | undefined): boolean {
  return member !== undefined && (member.role === 'master' || room?.playersCanCreateDocuments === true);
}

/** Tags are managed by an Administrator or the Master (`POST /rooms/{id}/tags`). */
export function canManageTags(member: Member | undefined): boolean {
  return member !== undefined && (member.isAdmin || member.role === 'master');
}
