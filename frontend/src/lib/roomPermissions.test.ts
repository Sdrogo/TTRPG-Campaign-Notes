import { describe, expect, it } from 'vitest';
import { canCreateDocuments, canManageTags } from './roomPermissions';
import type { Member } from '../types/member';
import type { Room } from '../types/room';

const noProfile = { email: null, displayName: null, pronouns: null, bio: null, avatarUrl: null };
const member = (role: Member['role'], isAdmin = false): Member => ({ ...noProfile, userId: 'u', role, isAdmin });
const room = (playersCanCreateDocuments: boolean): Room => ({
  id: 'r',
  name: 'Barovia',
  gameSystem: null,
  status: 'active',
  playersCanCreateDocuments,
});

describe('canCreateDocuments', () => {
  it('always lets the Master create', () => {
    expect(canCreateDocuments(member('master'), room(false))).toBe(true);
    expect(canCreateDocuments(member('master'), undefined)).toBe(true);
  });

  it('lets a Player create only when the Room allows it', () => {
    expect(canCreateDocuments(member('player'), room(true))).toBe(true);
    expect(canCreateDocuments(member('player'), room(false))).toBe(false);
    expect(canCreateDocuments(member('player'), undefined)).toBe(false);
  });

  it('denies a non-member', () => {
    expect(canCreateDocuments(undefined, room(true))).toBe(false);
  });
});

describe('canManageTags', () => {
  it('allows the Master and Administrators only', () => {
    expect(canManageTags(member('master'))).toBe(true);
    expect(canManageTags(member('player', true))).toBe(true);
    expect(canManageTags(member('player'))).toBe(false);
    expect(canManageTags(undefined)).toBe(false);
  });
});
