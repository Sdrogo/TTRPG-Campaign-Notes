import { describe, expect, it } from 'vitest';
import { friendLink, friendStatus } from '../../lib/friends';
import type { Friend, FriendsOverview } from '../../types/friend';

const friend = (userId: string): Friend => ({
  friendshipId: `friendship-${userId}`,
  userId,
  since: '2026-10-01T12:00:00Z',
  email: null,
  displayName: null,
  pronouns: null,
  bio: null,
  avatarUrl: null,
});

const overview: FriendsOverview = {
  friends: [friend('user-2')],
  incoming: [friend('user-3')],
  outgoing: [friend('user-4')],
};

describe('friendLink', () => {
  it('points at the friend-link page on this origin', () => {
    expect(friendLink('ab-c_1')).toBe(`${window.location.origin}/friends/add/ab-c_1`);
  });

  it('escapes the code', () => {
    expect(friendLink('a/b')).toBe(`${window.location.origin}/friends/add/a%2Fb`);
  });
});

describe('friendStatus', () => {
  it.each([
    ['user-2', 'friend'],
    ['user-3', 'incoming'],
    ['user-4', 'outgoing'],
    ['user-5', 'none'],
  ])('places %s as %s', (userId, status) => {
    expect(friendStatus(overview, userId)).toBe(status);
  });
});
