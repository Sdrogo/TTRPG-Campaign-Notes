import { act as reactAct } from '@testing-library/react';
import type { DragEndEvent, DragMoveEvent } from '@dnd-kit/core';
import { describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import {
  boardCollisions,
  dragAnnouncements,
  dragLabel,
  useBoardDrag,
  type DropData,
} from '../../../components/sessionZero/boardDrag';
import { boardWrites, toSessionZero, type RawSessionZero } from '../../../lib/sessionZero';
import { rawPostIt, rawPostItColumn, rawSessionZero } from '../../fixtures';
import { renderHookWithProviders } from '../../utils';

const board = toSessionZero(
  rawSessionZero({
    can_manage: true,
    retro: [
      rawPostItColumn({
        id: 'want',
        groups: [{ id: 'g1', title: null, position: 2 }],
        cards: [
          rawPostIt({ id: 'a', body: 'Draghi', position: 0, can_place: true, can_group: true }),
          rawPostIt({ id: 'b', body: 'Viverne', position: 1, can_place: true, can_group: true }),
          rawPostIt({ id: 'c', body: 'Drake', group_id: 'g1', position: 0, can_place: true, can_group: true }),
          rawPostIt({ id: 'd', body: 'Basilischi', group_id: 'g1', position: 1, can_place: true, can_group: true }),
        ],
      }),
    ],
  }) as RawSessionZero,
);

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

describe('boardCollisions', () => {
  const containers = ['card:a', 'group:g1', 'column:want'].map((id) => ({ id }));
  const rects = new Map([
    ['card:a', rect(10, 10, 100, 50)],
    ['group:g1', rect(0, 0, 200, 300)],
    ['column:want', rect(0, 0, 300, 600)],
  ]);
  const collide = (activeId: string, pointer: { x: number; y: number } | null) =>
    boardCollisions({
      active: { id: activeId },
      droppableContainers: containers,
      droppableRects: rects,
      pointerCoordinates: pointer,
      collisionRect: rect(400, 400, 20, 20),
    } as unknown as Parameters<typeof boardCollisions>[0]);

  it('picks the smallest droppable under the pointer', () => {
    expect(collide('card:b', { x: 20, y: 20 }).map((c) => c.id)).toEqual(['card:a']);
    expect(collide('card:b', { x: 150, y: 200 }).map((c) => c.id)).toEqual(['group:g1']);
    expect(collide('card:b', { x: 1000, y: 1000 })).toEqual([]);
  });

  it('lets a column meet only columns, and the keyboard use the dragged middle', () => {
    expect(collide('column:x', { x: 20, y: 20 }).map((c) => c.id)).toEqual(['column:want']);
    expect(collide('card:b', null)).toEqual([]);
  });

  it('skips a droppable not measured yet', () => {
    const result = boardCollisions({
      active: { id: 'card:b' },
      droppableContainers: [{ id: 'card:zz' }],
      droppableRects: new Map(),
      pointerCoordinates: { x: 0, y: 0 },
      collisionRect: rect(0, 0, 1, 1),
    } as unknown as Parameters<typeof boardCollisions>[0]);
    expect(result).toEqual([]);
  });
});

/** A drag event: `active` dragged from `start`, moved by `delta`, over a droppable carrying `data`. */
function dragEvent(
  activeId: string,
  data: DropData | null,
  { start, delta = { x: 0, y: 0 } }: { start?: Event; delta?: { x: number; y: number } } = {},
) {
  return {
    active: { id: activeId, rect: { current: { translated: rect(0, 30, 100, 30), initial: null } } },
    over: data && { id: 'over', rect: rect(0, 0, 100, 90), data: { current: data } },
    delta,
    activatorEvent: start ?? new MouseEvent('mousedown', { clientX: 10, clientY: 0 }),
    collisions: null,
  } as unknown as DragMoveEvent & DragEndEvent;
}

const overCard = (id: string): DropData => ({ ref: { kind: 'card', id }, axis: 'y' });

describe('useBoardDrag', () => {
  function render() {
    const act = vi.fn();
    const hook = renderHookWithProviders(() => useBoardDrag(board, act));
    const run = (fn: () => void) => reactAct(fn);
    return { act, hook, run };
  }

  // Spec 46d Decision 7: the drop shows where it lands as the pointer moves.
  it('follows the pointer: before, onto or after what it is over', () => {
    const { hook, run } = render();
    run(() => hook.result.current.handlers.onDragStart({ active: { id: 'card:b' } } as never));
    expect(hook.result.current.state).toEqual({ active: { kind: 'card', id: 'b' }, intent: null });

    run(() => hook.result.current.handlers.onDragMove(dragEvent('card:b', overCard('a'), { delta: { x: 0, y: 45 } })));
    expect(hook.result.current.state.intent).toEqual({ kind: 'group', withId: 'a' });
    const same = hook.result.current.state;
    run(() => hook.result.current.handlers.onDragMove(dragEvent('card:b', overCard('a'), { delta: { x: 0, y: 50 } })));
    expect(hook.result.current.state).toBe(same);

    run(() => hook.result.current.handlers.onDragMove(dragEvent('card:b', overCard('a'), { delta: { x: 0, y: 5 } })));
    expect(hook.result.current.state.intent).toEqual({ kind: 'place', columnId: 'want', groupId: null, beforeId: 'a' });

    // Over the line it opened, the drop stays put; over nothing, there is none.
    run(() => hook.result.current.handlers.onDragMove(dragEvent('card:b', { ref: null, axis: 'y' })));
    expect(hook.result.current.state.intent).toEqual({ kind: 'place', columnId: 'want', groupId: null, beforeId: 'a' });
    run(() => hook.result.current.handlers.onDragMove(dragEvent('card:b', null)));
    expect(hook.result.current.state.intent).toBeNull();

    run(() => hook.result.current.handlers.onDragCancel());
    expect(hook.result.current.state).toEqual({ active: null, intent: null });
  });

  it('reads a touch, and the dragged middle with the keyboard', () => {
    const { hook, run } = render();
    const touch = Object.create(TouchEvent.prototype) as TouchEvent;
    Object.defineProperty(touch, 'touches', { value: [{ clientX: 10, clientY: 80 }] });
    run(() => hook.result.current.handlers.onDragMove(dragEvent('card:a', overCard('b'), { start: touch })));
    expect(hook.result.current.state.intent).toEqual({ kind: 'place', columnId: 'want', groupId: null, beforeId: 'g1' });
    const lifted = Object.create(TouchEvent.prototype) as TouchEvent;
    Object.defineProperty(lifted, 'touches', { value: [] });
    run(() => hook.result.current.handlers.onDragMove(dragEvent('card:a', overCard('b'), { start: lifted })));
    expect(hook.result.current.state.intent).toEqual({ kind: 'group', withId: 'b' });
    run(() =>
      hook.result.current.handlers.onDragMove(dragEvent('card:a', overCard('b'), { start: new KeyboardEvent('keydown') })),
    );
    expect(hook.result.current.state.intent).toEqual({ kind: 'group', withId: 'b' });
  });

  it('sends the one write on drop, showing the board as it will look meanwhile', () => {
    const { act, hook, run } = render();
    run(() => hook.result.current.handlers.onDragStart({ active: { id: 'card:b' } } as never));
    run(() => hook.result.current.handlers.onDragEnd(dragEvent('card:b', overCard('a'), { delta: { x: 0, y: 5 } })));
    expect(act).toHaveBeenCalledWith(boardWrites.placeCard('b', 'want', null, 'a'), undefined, expect.any(Object));
    expect(act.mock.calls[0][2].retro[0].cards.find((c: { id: string }) => c.id === 'b').position).toBe(0);
    expect(hook.result.current.state).toEqual({ active: null, intent: null });

    run(() => hook.result.current.handlers.onDragEnd(dragEvent('card:b', overCard('a'), { delta: { x: 0, y: 45 } })));
    expect(act).toHaveBeenLastCalledWith(boardWrites.group(['a', 'b']), undefined, undefined);
    run(() => hook.result.current.handlers.onDragEnd(dragEvent('card:b', null)));
    expect(act).toHaveBeenCalledTimes(2);
  });
});

describe('dragLabel and dragAnnouncements', () => {
  const t = i18n.t.bind(i18n);
  it("names a post-it by its text, a group or column by its title", () => {
    expect(dragLabel(board, { kind: 'card', id: 'a' }, t)).toBe('Draghi');
    expect(dragLabel(board, { kind: 'card', id: 'zz' }, t)).toBe('');
    expect(dragLabel(board, { kind: 'group', id: 'g1' }, t)).toBe('Gruppo');
    expect(dragLabel(board, { kind: 'column', id: 'want' }, t)).toBe('Lo vogliamo al tavolo');
    expect(dragLabel(board, { kind: 'column', id: 'lv-must' }, t)).toBe('Must');
    expect(dragLabel(board, { kind: 'column', id: 'zz' }, t)).toBe('');
    const titled = { ...board, retro: [{ ...board.retro[0], groups: [{ id: 'g1', title: 'Rettili', position: 2 }] }] };
    expect(dragLabel(titled, { kind: 'group', id: 'g1' }, t)).toBe('Rettili');
  });

  it('tells a screen reader what was picked up, where it is and how it ended', () => {
    const say = dragAnnouncements(board, t);
    const active = { id: 'card:a' };
    expect(say.onDragStart({ active } as never)).toBe('Hai preso Draghi.');
    expect(say.onDragOver({ active, over: { id: 'card:b' } } as never)).toBe('Sopra Viverne.');
    expect(say.onDragOver({ active, over: null } as never)).toBe('Non sei sopra un punto dove lasciarlo.');
    expect(say.onDragEnd({ active, over: null } as never)).toBe('Hai lasciato Draghi.');
    expect(say.onDragCancel({ active, over: null } as never)).toBe('Annullato: Draghi è tornato al suo posto.');
  });
});
