import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readLastPostAs, saveLastPostAs, toCharacter } from '../../lib/characters';
import { rawCharacter } from '../fixtures';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('toCharacter', () => {
  it('maps the wire shape', () => {
    expect(toCharacter(rawCharacter({ image_url: null }))).toEqual({
      documentId: 'doc-2',
      name: 'Aria',
      imageUrl: null,
    });
  });
});

describe('last "Post as" choice', () => {
  it('starts as yourself', () => {
    expect(readLastPostAs('room-1')).toBeNull();
  });

  it('is remembered per Room, and forgotten by choosing yourself', () => {
    saveLastPostAs('room-1', 'doc-2');

    expect(readLastPostAs('room-1')).toBe('doc-2');
    expect(readLastPostAs('room-2')).toBeNull();

    saveLastPostAs('room-1', null);
    expect(readLastPostAs('room-1')).toBeNull();
  });

  // Blocked site data makes the Storage accessors throw.
  it('does not throw when storage is unavailable', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);

    expect(() => saveLastPostAs('room-1', 'doc-2')).not.toThrow();
    expect(readLastPostAs('room-1')).toBeNull();
  });
});
