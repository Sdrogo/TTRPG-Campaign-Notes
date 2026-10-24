/**
 * Per-item saves (spec 43): the shapes of what an editor changed on a map,
 * for a free board and a geographic map alike (`lib/boardChanges.ts`).
 */

/** A board: one list of items with an id per kind. */
export type BoardShape<B> = { [K in keyof B]: readonly { id: string }[] };

/** The board as the API takes it: one list of item bodies per kind. */
export type BoardBody<B> = { [K in keyof B]: unknown[] };

/** What changed in one kind: the items created or changed, whole, and the ids created and removed. */
export interface ItemChanges<T> {
  changed: T[];
  createdIds: string[];
  deletedIds: string[];
}

/** What changed on a board, kind by kind. */
export type BoardChanges<B extends BoardShape<B>> = { [K in keyof B]: ItemChanges<B[K][number]> };

/** A save of an editor's changes and the map revision they last saw (spec 43 Decision 2: informative only). */
export interface ChangesSave<B extends BoardShape<B>> {
  changes: BoardChanges<B>;
  baseRevision: number;
}
