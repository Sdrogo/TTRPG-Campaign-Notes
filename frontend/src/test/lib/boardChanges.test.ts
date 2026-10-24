import { describe, expect, it } from 'vitest';
import { applyChanges, diffBoard, isUnchanged, toChangesBody } from '../../lib/boardChanges';

interface Item {
  id: string;
  x: number;
  /** Filled in by the server only, never sent. */
  look?: string;
}
interface Toy {
  items: Item[];
  marks: Item[];
}

const body = (board: Toy) => ({
  items: board.items.map(({ id, x }) => ({ id, x })),
  marks: board.marks.map(({ id, x }) => ({ id, x })),
});

const a = { id: 'a', x: 1 };
const b = { id: 'b', x: 2 };
const c = { id: 'c', x: 3 };

describe('per-item changes (spec 43)', () => {
  it('finds what was created, changed and removed, ignoring what is never sent', () => {
    const base: Toy = { items: [a, b], marks: [c] };
    const next: Toy = { items: [{ ...a, x: 9, look: 'signed-link-2' }, { id: 'd', x: 4 }], marks: [{ ...c, look: 'new' }] };
    const changes = diffBoard(base, next, body);
    expect(changes.items).toEqual({
      changed: [next.items[0], next.items[1]],
      createdIds: ['d'],
      deletedIds: ['b'],
    });
    expect(changes.marks).toEqual({ changed: [], createdIds: [], deletedIds: [] });
    expect(isUnchanged(changes)).toBe(false);
    expect(isUnchanged(diffBoard(base, { ...base, marks: [{ ...c, look: 'x' }] }, body))).toBe(true);
  });

  it('lays changes over a newer board, dropping changes to what is gone', () => {
    const base: Toy = { items: [a, b], marks: [] };
    const mine = diffBoard(base, { items: [{ ...a, x: 5 }, { ...b, x: 6 }, c], marks: [] }, body);
    // Meanwhile someone deleted b and added e.
    const newer: Toy = { items: [a, { id: 'e', x: 7 }], marks: [] };
    expect(applyChanges(newer, mine)).toEqual({ items: [{ ...a, x: 5 }, { id: 'e', x: 7 }, c], marks: [] });

    const removing = diffBoard(base, { items: [b], marks: [] }, body);
    expect(applyChanges(newer, removing).items).toEqual([{ id: 'e', x: 7 }]);
    // A new item the newer board already has is not added twice.
    expect(applyChanges({ items: [c], marks: [] }, mine).items).toEqual([c]);
  });

  it('sends the changed bodies, the ids created and removed, and the revision', () => {
    const changes = diffBoard({ items: [a], marks: [b] }, { items: [{ ...a, x: 0 }, c], marks: [] }, body);
    expect(toChangesBody(changes, body, 4)).toEqual({
      items: [
        { id: 'a', x: 0 },
        { id: 'c', x: 3 },
      ],
      marks: [],
      base_revision: 4,
      created_ids: ['c'],
      deleted_ids: ['b'],
    });
  });
});
