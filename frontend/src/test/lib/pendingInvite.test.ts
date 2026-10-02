import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingFriendCode,
  clearPendingInvite,
  readPendingFriendCode,
  readPendingInvite,
  savePendingFriendCode,
  savePendingInvite,
} from '../../lib/pendingInvite';

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('pendingInvite', () => {
  it('returns nothing when no code was saved', () => {
    expect(readPendingInvite()).toBeNull();
  });

  it('keeps a saved code until it is cleared', () => {
    savePendingInvite('ABC123');
    expect(readPendingInvite()).toBe('ABC123');

    clearPendingInvite();
    expect(readPendingInvite()).toBeNull();
  });

  // Blocked site data makes the Storage accessors throw.
  it('does not throw when storage is unavailable', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);

    expect(() => savePendingInvite('ABC123')).not.toThrow();
    expect(readPendingInvite()).toBeNull();
    expect(() => clearPendingInvite()).not.toThrow();
  });

  // A friend link and an invite link opened before signing in are separate:
  // finishing one must not drop the other.
  it('keeps a Friend code apart from an invitation code', () => {
    savePendingInvite('ABC123');
    savePendingFriendCode('FRIEND1');
    expect(readPendingFriendCode()).toBe('FRIEND1');

    clearPendingFriendCode();
    expect(readPendingFriendCode()).toBeNull();
    expect(readPendingInvite()).toBe('ABC123');
  });

  it('does not throw for a Friend code when storage is unavailable', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);

    expect(() => savePendingFriendCode('FRIEND1')).not.toThrow();
    expect(readPendingFriendCode()).toBeNull();
    expect(() => clearPendingFriendCode()).not.toThrow();
  });
});
