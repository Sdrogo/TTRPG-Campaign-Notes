import { useState } from 'react';

/** Where each block of a list about to be saved comes from: its index in the list on screen, or null for a new one. */
export type BlockOrigins = (number | null)[];

export interface BlockKeysState {
  ids: string[];
  keys: string[];
  /** The origins of the list last sent, until the list on screen changes to it. */
  pending: BlockOrigins | null;
  next: number;
}

export const INITIAL_BLOCK_KEYS: BlockKeysState = { ids: [], keys: [], pending: null, next: 0 };

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * The render keys of `ids`, carried over from `state`'s list. A save gives
 * every block a new id (the optimistic `new-N`, then the server's), so
 * keying the blocks by id would remount them all on every save: a folded
 * block would open again and the page would jump. The origins of the list
 * last sent say where each block came from; without them a block keeps its
 * key when its id is still there; otherwise, in a list as long as the last
 * one (the server's answer to the optimistic list), it keeps its place's
 * key. A block nothing matches gets a new key, and no key is given twice.
 */
export function nextBlockKeys(state: BlockKeysState, ids: string[]): BlockKeysState {
  if (sameIds(ids, state.ids)) return state;
  let next = state.next;
  const used = new Set<string>();
  const take = (key: string | undefined) => {
    const chosen = key !== undefined && !used.has(key) ? key : `block-key-${next++}`;
    used.add(chosen);
    return chosen;
  };
  const pending = state.pending && state.pending.length === ids.length ? state.pending : null;
  const keys = ids.map((id, index) => {
    if (pending) {
      const origin = pending[index];
      return take(origin === null ? undefined : state.keys[origin]);
    }
    const kept = state.ids.indexOf(id);
    if (kept >= 0) return take(state.keys[kept]);
    return take(ids.length === state.ids.length ? state.keys[index] : undefined);
  });
  return { ids, keys, pending: pending ? null : state.pending, next };
}

/**
 * Render keys for a Section's blocks that outlive a save (see
 * `nextBlockKeys`), and `expect`, to call with a list's origins just before
 * saving it.
 */
export function useBlockKeys(ids: string[]) {
  const [state, setState] = useState(INITIAL_BLOCK_KEYS);
  const current = nextBlockKeys(state, ids);
  // Adjusted while rendering, as React allows for state derived from props.
  if (current !== state) setState(current);
  const expect = (origins: BlockOrigins) => setState((previous) => ({ ...previous, pending: origins }));
  return { keys: current.keys, expect };
}
