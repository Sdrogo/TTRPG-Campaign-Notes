/**
 * Per-item saves (spec 43): what an editor changed on a map since the board
 * the server last confirmed, and the same changes laid over a newer board.
 * Works for a free board (groups, cards, arrows) and a geographic map
 * (areas, pins, links) alike: every kind is a list of items with an id.
 */

import type { BoardBody, BoardChanges, BoardShape, ItemChanges } from '../types/boardChanges';

function kinds<B extends BoardShape<B>>(board: B): (keyof B)[] {
  return Object.keys(board) as (keyof B)[];
}

/**
 * What `next` changes on `base`. Items are compared as they are sent
 * (`toBody`), so what only the server fills in, such as a Document's name or
 * a signed image link, never counts as a change.
 */
export function diffBoard<B extends BoardShape<B>>(
  base: B,
  next: B,
  toBody: (board: B) => BoardBody<B>,
): BoardChanges<B> {
  const baseBody = toBody(base);
  const nextBody = toBody(next);
  const changes = {} as BoardChanges<B>;
  for (const kind of kinds(next)) {
    const before = new Map(base[kind].map((item, index) => [item.id, JSON.stringify(baseBody[kind][index])]));
    const after = new Set(next[kind].map((item) => item.id));
    const changed = next[kind].filter((item, index) => before.get(item.id) !== JSON.stringify(nextBody[kind][index]));
    changes[kind] = {
      changed,
      createdIds: changed.filter((item) => !before.has(item.id)).map((item) => item.id),
      deletedIds: base[kind].filter((item) => !after.has(item.id)).map((item) => item.id),
    };
  }
  return changes;
}

/** True when `changes` changes nothing. */
export function isUnchanged<B extends BoardShape<B>>(changes: BoardChanges<B>): boolean {
  return Object.values<ItemChanges<unknown>>(changes).every(
    (kind) => kind.changed.length === 0 && kind.deletedIds.length === 0,
  );
}

/**
 * `changes` laid over `base`, the way the server lays them over the stored
 * board (spec 43 Decision 1): a changed item takes its place, a new one goes
 * at the end, a removed one goes, and a change to an item `base` no longer
 * has (someone deleted it) is dropped.
 */
export function applyChanges<B extends BoardShape<B>>(base: B, changes: BoardChanges<B>): B {
  const board = { ...base };
  for (const kind of kinds(base)) {
    const { changed, createdIds, deletedIds } = changes[kind];
    const byId = new Map(changed.map((item) => [item.id, item]));
    const present = new Set(base[kind].map((item) => item.id));
    const removed = new Set(deletedIds);
    const created = new Set(createdIds);
    board[kind] = [
      ...base[kind].map((item) => byId.get(item.id) ?? item),
      ...changed.filter((item) => created.has(item.id) && !present.has(item.id)),
    ].filter((item) => !removed.has(item.id)) as unknown as B[keyof B];
  }
  return board;
}

/**
 * `changes` as `PATCH .../board` or `PATCH .../geo` takes them: the changed
 * items' bodies per kind, the ids created and removed, and the revision the
 * client last saw (informative only, spec 43 Decision 2).
 */
export function toChangesBody<B extends BoardShape<B>>(
  changes: BoardChanges<B>,
  toBody: (board: B) => BoardBody<B>,
  baseRevision: number,
) {
  const changed = {} as B;
  for (const kind of Object.keys(changes) as (keyof B)[]) {
    changed[kind] = changes[kind].changed as unknown as B[keyof B];
  }
  const all = Object.values<ItemChanges<unknown>>(changes);
  return {
    ...toBody(changed),
    base_revision: baseRevision,
    created_ids: all.flatMap((kind) => kind.createdIds),
    deleted_ids: all.flatMap((kind) => kind.deletedIds),
  };
}
