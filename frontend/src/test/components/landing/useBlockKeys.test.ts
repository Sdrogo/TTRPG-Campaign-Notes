import { describe, expect, it } from 'vitest';
import { INITIAL_BLOCK_KEYS, nextBlockKeys } from '../../../components/landing/useBlockKeys';

describe('nextBlockKeys', () => {
  it('keeps the keys while the ids stay, and follows a block whose id stays', () => {
    const state = nextBlockKeys(INITIAL_BLOCK_KEYS, ['a', 'b']);
    expect(nextBlockKeys(state, ['a', 'b'])).toBe(state);
    expect(nextBlockKeys(state, ['b', 'a']).keys).toEqual([state.keys[1], state.keys[0]]);
  });

  it('follows the origins of the list sent, then the places of the server answer', () => {
    const state = nextBlockKeys(INITIAL_BLOCK_KEYS, ['a', 'b', 'c']);
    const [a, b, c] = state.keys;
    // c moved first, b deleted, a new block last.
    const optimistic = nextBlockKeys({ ...state, pending: [2, 0, null] }, ['new-0', 'new-1', 'new-2']);
    expect(optimistic.keys.slice(0, 2)).toEqual([c, a]);
    expect([a, b, c]).not.toContain(optimistic.keys[2]);
    expect(optimistic.pending).toBeNull();
    expect(nextBlockKeys(optimistic, ['c2', 'a2', 'd2']).keys).toEqual(optimistic.keys);
  });

  it('gives new keys to new ids in a list of another length, and never twice the same key', () => {
    const state = nextBlockKeys(INITIAL_BLOCK_KEYS, ['a', 'b']);
    const { keys } = nextBlockKeys(state, ['x', 'a', 'y']);
    expect(keys[1]).toBe(state.keys[0]);
    expect(new Set(keys).size).toBe(3);
  });
});
