import { describe, expect, it } from 'vitest';
import { boardWrites, toSessionZero, type RawSessionZero } from '../../lib/sessionZero';
import {
  columnItems,
  dragKey,
  dropIntent,
  intentWrite,
  parseDragKey,
  previewBoard,
  showsLine,
  zoneOf,
  type DragRef,
  type DropTarget,
  type Zone,
} from '../../lib/sessionZeroDnd';
import { rawPostIt, rawPostItColumn, rawSessionZero } from '../fixtures';

/** A post-it the Master may drag, group and promote. */
function card(id: string, overrides: Record<string, unknown> = {}) {
  return rawPostIt({ id, body: id, can_place: true, can_group: true, can_promote: true, ...overrides });
}

/**
 * The open round as the Master sees it: "Want" holds a, group g1 (b, c), d
 * and the Master's draft e; "Avoid" holds f; Must holds m1 and m2.
 */
function makeBoard(overrides: Record<string, unknown> = {}, cards: Record<string, Record<string, unknown>> = {}) {
  const c = (id: string, extra: Record<string, unknown>) => card(id, { ...extra, ...cards[id] });
  return toSessionZero(
    rawSessionZero({
      can_manage: true,
      retro: [
        rawPostItColumn({
          id: 'want',
          groups: [{ id: 'g1', title: 'Draghi', position: 1 }],
          cards: [
            c('a', { column_id: 'want', position: 0 }),
            c('b', { column_id: 'want', group_id: 'g1', position: 0 }),
            c('c', { column_id: 'want', group_id: 'g1', position: 1 }),
            c('d', { column_id: 'want', position: 2 }),
            c('e', { column_id: 'want', position: 3, draft: true, can_group: false, can_promote: false }),
          ],
        }),
        rawPostItColumn({ id: 'avoid', cards: [c('f', { column_id: 'avoid', position: 0 })] }),
      ],
      lines_veils: [
        rawPostItColumn({
          id: 'lv-must',
          kind: 'must',
          cards: [
            c('m1', { column_id: 'lv-must', position: 0, can_promote: false, can_group: false }),
            c('m2', { column_id: 'lv-must', position: 1, can_promote: false, can_group: false }),
          ],
        }),
        rawPostItColumn({ id: 'lv-veils', kind: 'veils' }),
        rawPostItColumn({ id: 'lv-lines', kind: 'lines' }),
      ],
      ...overrides,
    }) as RawSessionZero,
  );
}

const board = makeBoard();
const cardRef = (id: string): DragRef => ({ kind: 'card', id });
const over = (kind: DragRef['kind'], id: string, zone: Zone = 'before'): DropTarget => ({ ref: { kind, id }, zone });
const place = (columnId: string, groupId: string | null, beforeId: string | null, join?: boolean) =>
  join ? { kind: 'place', columnId, groupId, beforeId, join } : { kind: 'place', columnId, groupId, beforeId };

describe('drag keys', () => {
  it('name a draggable by its kind and id, and read it back', () => {
    expect(dragKey({ kind: 'group', id: 'g:1' })).toBe('group:g:1');
    expect(parseDragKey('group:g:1')).toEqual({ kind: 'group', id: 'g:1' });
  });
});

describe('columnItems', () => {
  // Spec 46d Decision 7: lone post-its and groups share one order.
  it('orders the lone post-its and groups by position, each group by its own', () => {
    const items = columnItems(board.retro[0]);
    expect(items.map((item) => (item.kind === 'card' ? item.card.id : item.cards.map((c) => c.id)))).toEqual([
      'a',
      ['b', 'c'],
      'd',
      'e',
    ]);
  });

  it('leaves out a group with no post-it to show', () => {
    expect(columnItems({ ...board.retro[0], cards: [] })).toEqual([]);
  });
});

describe('zoneOf', () => {
  const rect = { left: 0, top: 0, width: 300, height: 90 };
  it('splits what is under the pointer in thirds along its axis', () => {
    expect(zoneOf(rect, { x: 0, y: 10 }, 'y')).toBe('before');
    expect(zoneOf(rect, { x: 0, y: 45 }, 'y')).toBe('middle');
    expect(zoneOf(rect, { x: 0, y: 80 }, 'y')).toBe('after');
    expect(zoneOf(rect, { x: 250, y: 10 }, 'x')).toBe('after');
  });
});

describe('dropIntent: a post-it', () => {
  it('lands nowhere over nothing, or when it is unknown', () => {
    expect(dropIntent(board, cardRef('a'), null)).toBeNull();
    expect(dropIntent(board, cardRef('zz'), over('card', 'd'))).toBeNull();
    expect(dropIntent(board, cardRef('a'), over('column', 'zz'))).toBeNull();
    expect(dropIntent(board, cardRef('a'), over('card', 'zz'))).toBeNull();
    expect(dropIntent(board, cardRef('a'), over('card', 'a'))).toBeNull();
  });

  it('goes last in a column dropped on, not where it already is', () => {
    expect(dropIntent(board, cardRef('a'), over('column', 'avoid'))).toEqual(place('avoid', null, null));
    expect(dropIntent(board, cardRef('e'), over('column', 'want'))).toBeNull();
    expect(dropIntent(board, cardRef('m1'), over('column', 'lv-must'))).toEqual(place('lv-must', null, null));
    expect(dropIntent(board, cardRef('m1'), over('column', 'want'))).toBeNull();
    const player = makeBoard({ can_manage: false }, { a: { can_place: false } });
    expect(dropIntent(player, cardRef('a'), over('column', 'avoid'))).toBeNull();
  });

  // Spec 46 Decision 2: a Retro post-it dropped on Lines & Veils is promoted.
  it('is promoted onto a Lines & Veils row or post-it by the Master only', () => {
    expect(dropIntent(board, cardRef('a'), over('column', 'lv-veils'))).toEqual({ kind: 'promote', columnId: 'lv-veils' });
    expect(dropIntent(board, cardRef('a'), over('card', 'm1'))).toEqual({ kind: 'promote', columnId: 'lv-must' });
    expect(dropIntent(board, cardRef('e'), over('column', 'lv-veils'))).toBeNull();
    expect(dropIntent(board, cardRef('e'), over('card', 'm1'))).toBeNull();
  });

  it('moves between post-its of Lines & Veils, never onto the Retro board', () => {
    expect(dropIntent(board, cardRef('m2'), over('card', 'm1', 'before'))).toEqual(place('lv-must', null, 'm1'));
    expect(dropIntent(board, cardRef('m1'), over('card', 'm2', 'after'))).toEqual(place('lv-must', null, null));
    expect(dropIntent(board, cardRef('m1'), over('card', 'a'))).toBeNull();
    const player = makeBoard({ can_manage: false }, { m1: { can_place: false } });
    expect(dropIntent(player, cardRef('m1'), over('card', 'm2', 'after'))).toBeNull();
  });

  it('lands before or after a post-it, in its group or none', () => {
    expect(dropIntent(board, cardRef('d'), over('card', 'a', 'before'))).toEqual(place('want', null, 'a'));
    expect(dropIntent(board, cardRef('a'), over('card', 'd', 'after'))).toEqual(place('want', null, 'e'));
    expect(dropIntent(board, cardRef('a'), over('card', 'b', 'before'))).toEqual(place('want', 'g1', 'b'));
    expect(dropIntent(board, cardRef('b'), over('card', 'c', 'after'))).toEqual(place('want', 'g1', null));
    expect(dropIntent(board, cardRef('f'), over('card', 'a', 'middle'))).toEqual(place('want', null, 'a'));
    // Where it already is, nothing changes.
    expect(dropIntent(board, cardRef('d'), over('card', 'e', 'before'))).toBeNull();
    expect(dropIntent(board, cardRef('c'), over('card', 'b', 'after'))).toBeNull();
    // The Master's draft moves, but joins no group.
    expect(dropIntent(board, cardRef('e'), over('card', 'a', 'before'))).toEqual(place('want', null, 'a'));
    expect(dropIntent(board, cardRef('e'), over('card', 'b', 'before'))).toBeNull();
    expect(dropIntent(board, cardRef('m1'), over('card', 'a'))).toBeNull();
    const player = makeBoard({ can_manage: false }, { a: { can_place: false } });
    expect(dropIntent(player, cardRef('a'), over('card', 'd'))).toBeNull();
  });

  // Spec 46c Decision 9 and 46d Decision 7: over a post-it's middle, they group.
  it('groups with a lone post-it of its column, or joins the group of the one it is over', () => {
    expect(dropIntent(board, cardRef('d'), over('card', 'a', 'middle'))).toEqual({ kind: 'group', withId: 'a' });
    expect(dropIntent(board, cardRef('a'), over('card', 'c', 'middle'))).toEqual(place('want', 'g1', null, true));
    expect(dropIntent(board, cardRef('f'), over('card', 'b', 'middle'))).toEqual(place('want', 'g1', null, true));
    // Within its own group, or out of one onto a lone post-it, it is placed instead.
    expect(dropIntent(board, cardRef('c'), over('card', 'b', 'middle'))).toEqual(place('want', 'g1', 'b'));
    expect(dropIntent(board, cardRef('b'), over('card', 'd', 'middle'))).toEqual(place('want', null, 'd'));
  });

  // Spec 46d Q2: a Player groups only their own, in groups holding only theirs.
  it("keeps a Player's post-its out of groups holding someone else's", () => {
    const player = makeBoard({ can_manage: false }, { c: { mine: false, can_group: false, can_place: false } });
    expect(dropIntent(player, cardRef('a'), over('card', 'b', 'middle'))).toBeNull();
    expect(dropIntent(player, cardRef('a'), over('card', 'b', 'before'))).toBeNull();
    expect(dropIntent(player, cardRef('b'), over('card', 'd', 'before'))).toBeNull();
    expect(dropIntent(player, cardRef('b'), over('column', 'avoid'))).toBeNull();
    expect(dropIntent(player, cardRef('b'), over('card', 'c', 'after'))).toEqual(place('want', 'g1', null));
    expect(dropIntent(player, cardRef('a'), over('group', 'g1', 'middle'))).toBeNull();
    const own = makeBoard({ can_manage: false });
    expect(dropIntent(own, cardRef('a'), over('card', 'b', 'middle'))).toEqual(place('want', 'g1', null, true));
    const mixedOrigin = makeBoard({ can_manage: false }, { b: { mine: false, can_group: false } });
    expect(dropIntent(mixedOrigin, cardRef('c'), over('card', 'f', 'middle'))).toBeNull();
    expect(dropIntent(mixedOrigin, cardRef('c'), over('group', 'g1', 'before'))).toBeNull();
    const twoGroups = makeBoard({ can_manage: false }, { b: { mine: false, can_group: false }, f: { group_id: 'g2' } });
    twoGroups.retro[1].groups = [{ id: 'g2', title: null, position: 0 }];
    expect(dropIntent(twoGroups, cardRef('c'), over('group', 'g2', 'middle'))).toBeNull();
    const elsewhere = makeBoard({}, { f: { group_id: 'g2' } });
    const mixedTarget = { ...elsewhere, canManage: false };
    mixedTarget.retro[1].groups = [{ id: 'g2', title: null, position: 0 }];
    mixedTarget.retro[1].cards[0].mine = false;
    expect(dropIntent(mixedTarget, cardRef('a'), over('card', 'f', 'middle'))).toBeNull();
    expect(dropIntent(mixedTarget, cardRef('b'), over('card', 'f', 'middle'))).toBeNull();
  });

  it('joins a group dropped onto, or lands beside it', () => {
    expect(dropIntent(board, cardRef('a'), over('group', 'g1', 'middle'))).toEqual(place('want', 'g1', null, true));
    expect(dropIntent(board, cardRef('d'), over('group', 'g1', 'before'))).toEqual(place('want', null, 'g1'));
    expect(dropIntent(board, cardRef('a'), over('group', 'g1', 'after'))).toEqual(place('want', null, 'd'));
    expect(dropIntent(board, cardRef('b'), over('group', 'g1', 'middle'))).toBeNull();
    expect(dropIntent(board, cardRef('e'), over('group', 'g1', 'middle'))).toBeNull();
    expect(dropIntent(board, cardRef('a'), over('group', 'zz', 'middle'))).toBeNull();
    expect(dropIntent(board, cardRef('m1'), over('group', 'g1', 'middle'))).toBeNull();
    const player = makeBoard({ can_manage: false }, { a: { can_place: false } });
    expect(dropIntent(player, cardRef('a'), over('group', 'g1', 'middle'))).toBeNull();
  });
});

describe('dropIntent: a group', () => {
  const group: DragRef = { kind: 'group', id: 'g1' };
  it('moves as one block among the lone post-its and groups of a Retro column', () => {
    expect(dropIntent(board, group, over('column', 'avoid'))).toEqual(place('avoid', null, null));
    expect(dropIntent(board, group, over('card', 'a', 'before'))).toEqual(place('want', null, 'a'));
    expect(dropIntent(board, group, over('card', 'd', 'after'))).toEqual(place('want', null, 'e'));
    expect(dropIntent(board, group, over('card', 'f', 'middle'))).toEqual(place('avoid', null, 'f'));
    // Where it already is, over itself or off the Retro board, nothing.
    expect(dropIntent(board, group, over('card', 'a', 'after'))).toBeNull();
    expect(dropIntent(board, group, over('card', 'b'))).toBeNull();
    expect(dropIntent(board, group, over('group', 'g1'))).toBeNull();
    expect(dropIntent(board, group, over('card', 'm1'))).toBeNull();
    expect(dropIntent(board, group, over('card', 'zz'))).toBeNull();
    expect(dropIntent(board, group, over('column', 'lv-must'))).toBeNull();
    expect(dropIntent(board, group, over('group', 'zz'))).toBeNull();
    const moved = makeBoard({}, { e: { position: 1 } });
    moved.retro[0].groups[0].position = 3;
    expect(dropIntent(moved, group, over('column', 'want'))).toBeNull();
  });

  it('lands beside another group, or over one of its post-its', () => {
    const two = makeBoard({}, { f: { group_id: 'g2' }, a: { column_id: 'avoid' } });
    two.retro[1].groups = [{ id: 'g2', title: null, position: 0 }];
    two.retro[1].cards = [...two.retro[1].cards, { ...two.retro[1].cards[0], id: 'f2', position: 1 }];
    expect(dropIntent(two, group, over('group', 'g2', 'after'))).toEqual(place('avoid', null, null));
    expect(dropIntent(two, group, over('card', 'f2', 'before'))).toEqual(place('avoid', null, 'g2'));
  });
});

describe('dropIntent: a column', () => {
  const column: DragRef = { kind: 'column', id: 'want' };
  it('lands before or after another Retro column', () => {
    expect(dropIntent(board, column, over('column', 'avoid', 'after'))).toEqual({ kind: 'column', beforeId: null });
    expect(dropIntent(board, { kind: 'column', id: 'avoid' }, over('column', 'want', 'middle'))).toEqual({
      kind: 'column',
      beforeId: 'want',
    });
    expect(dropIntent(board, column, over('column', 'avoid', 'before'))).toBeNull();
    expect(dropIntent(board, column, over('column', 'want'))).toBeNull();
    expect(dropIntent(board, column, over('column', 'lv-must'))).toBeNull();
    expect(dropIntent(board, column, over('card', 'a'))).toBeNull();
  });
});

describe('intentWrite', () => {
  it('sends the one write the drop means', () => {
    expect(intentWrite(board, cardRef('d'), { kind: 'group', withId: 'a' })).toEqual(boardWrites.group(['a', 'd']));
    expect(intentWrite(board, cardRef('a'), { kind: 'promote', columnId: 'lv-must' })).toEqual(
      boardWrites.promote('a', 'lv-must'),
    );
    expect(intentWrite(board, { kind: 'column', id: 'want' }, { kind: 'column', beforeId: null })).toEqual(
      boardWrites.reorderColumns(['avoid', 'want']),
    );
    expect(intentWrite(board, { kind: 'column', id: 'avoid' }, { kind: 'column', beforeId: 'want' })).toEqual(
      boardWrites.reorderColumns(['avoid', 'want']),
    );
    expect(intentWrite(board, cardRef('a'), { kind: 'place', columnId: 'want', groupId: 'g1', beforeId: 'c' })).toEqual(
      boardWrites.placeCard('a', 'want', 'g1', 'c'),
    );
    expect(
      intentWrite(board, { kind: 'group', id: 'g1' }, { kind: 'place', columnId: 'avoid', groupId: null, beforeId: null }),
    ).toEqual(boardWrites.placeGroup('g1', 'avoid', null));
  });
});

describe('previewBoard', () => {
  const ids = (b: ReturnType<typeof makeBoard>, index: number) =>
    columnItems(b.retro[index]).map((item) => (item.kind === 'card' ? item.card.id : item.cards.map((c) => c.id)));

  it('shows the post-it in its new place at once', () => {
    const moved = previewBoard(board, cardRef('d'), { kind: 'place', columnId: 'want', groupId: null, beforeId: 'a' })!;
    expect(ids(moved, 0)).toEqual(['d', 'a', ['b', 'c'], 'e']);
    const joined = previewBoard(board, cardRef('f'), { kind: 'place', columnId: 'want', groupId: 'g1', beforeId: 'c' })!;
    expect(ids(joined, 0)).toEqual(['a', ['b', 'f', 'c'], 'd', 'e']);
    expect(ids(joined, 1)).toEqual([]);
    const last = previewBoard(board, cardRef('a'), { kind: 'place', columnId: 'avoid', groupId: null, beforeId: null })!;
    expect(ids(last, 1)).toEqual(['f', 'a']);
    expect(joined.retro[0].cards.find((c) => c.id === 'f')).toMatchObject({ columnId: 'want', groupId: 'g1' });
    const row = previewBoard(board, cardRef('m2'), { kind: 'place', columnId: 'lv-must', groupId: null, beforeId: 'm1' })!;
    expect(columnItems(row.linesVeils[0]).map((item) => item.kind === 'card' && item.card.id)).toEqual(['m2', 'm1']);
  });

  it('moves a group with its post-its', () => {
    const moved = previewBoard(board, { kind: 'group', id: 'g1' }, {
      kind: 'place',
      columnId: 'avoid',
      groupId: null,
      beforeId: 'f',
    })!;
    expect(ids(moved, 0)).toEqual(['a', 'd', 'e']);
    expect(ids(moved, 1)).toEqual([['b', 'c'], 'f']);
  });

  it('reorders the columns, and waits for the answer on a new group or a promotion', () => {
    const columns = previewBoard(board, { kind: 'column', id: 'avoid' }, { kind: 'column', beforeId: 'want' })!;
    expect(columns.retro.map((c) => c.id)).toEqual(['avoid', 'want']);
    expect(previewBoard(board, cardRef('d'), { kind: 'group', withId: 'a' })).toBeNull();
    expect(previewBoard(board, cardRef('d'), { kind: 'promote', columnId: 'lv-must' })).toBeNull();
  });
});

describe('showsLine', () => {
  const intent = { kind: 'place', columnId: 'want', groupId: 'g1', beforeId: 'c' } as const;
  it('shows the line only where the drop lands, never for a group joined whole', () => {
    expect(showsLine(intent, 'want', 'g1', 'c')).toBe(true);
    expect(showsLine(intent, 'want', 'g1', null)).toBe(false);
    expect(showsLine(intent, 'want', null, 'c')).toBe(false);
    expect(showsLine(intent, 'avoid', 'g1', 'c')).toBe(false);
    expect(showsLine({ ...intent, join: true }, 'want', 'g1', 'c')).toBe(false);
    expect(showsLine({ kind: 'group', withId: 'a' }, 'want', null, null)).toBe(false);
    expect(showsLine(null, 'want', null, null)).toBe(false);
  });
});
