import { boardWrites, type BoardWrite } from './sessionZero';
import type { PostIt, PostItColumn, PostItGroup, SessionZero } from '../types/sessionZero';

/**
 * Drag and drop on the Session 0 boards (spec 46d Decision 7): what is
 * dragged, what it is over, where it would land, the write that puts it
 * there and the board as it will look meanwhile. Pure: `BoardDnd` wires it
 * to `@dnd-kit/core`.
 */

/** What can be dragged, and dropped on: a post-it, a group, a column. */
export type DragKind = 'card' | 'group' | 'column';

export interface DragRef {
  kind: DragKind;
  id: string;
}

/** The id `@dnd-kit` knows a draggable or droppable by: `card:<id>`, `group:<id>`, `column:<id>`. */
export function dragKey(ref: DragRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function parseDragKey(key: string | number): DragRef {
  const text = String(key);
  const colon = text.indexOf(':');
  return { kind: text.slice(0, colon) as DragKind, id: text.slice(colon + 1) };
}

/** A column's post-its in no group and its groups, in their one order; a group with its post-its. */
export type ColumnItem = { kind: 'card'; card: PostIt } | { kind: 'group'; group: PostItGroup; cards: PostIt[] };

/**
 * The column as drawn: its post-its in no group and its groups by
 * `position`, each group's post-its by theirs. A group whose post-its the
 * viewer can't see (none) isn't drawn.
 */
export function columnItems(column: PostItColumn): ColumnItem[] {
  const items: { position: number; item: ColumnItem }[] = [];
  for (const card of column.cards) {
    if (card.groupId === null) items.push({ position: card.position, item: { kind: 'card', card } });
  }
  for (const group of column.groups) {
    const cards = column.cards
      .filter((card) => card.groupId === group.id)
      .sort((a, b) => a.position - b.position);
    if (cards.length > 0) items.push({ position: group.position, item: { kind: 'group', group, cards } });
  }
  return items.sort((a, b) => a.position - b.position).map(({ item }) => item);
}

function itemId(item: ColumnItem): string {
  return item.kind === 'card' ? item.card.id : item.group.id;
}

/** Which part of what it is over the dragged item's middle is in: its first, middle or last third. */
export type Zone = 'before' | 'middle' | 'after';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Post-its stack down a Retro column (`y`), side by side in a Lines & Veils row and columns (`x`). */
export type Axis = 'x' | 'y';

export function zoneOf(rect: Rect, point: { x: number; y: number }, axis: Axis): Zone {
  const fraction = axis === 'y' ? (point.y - rect.top) / rect.height : (point.x - rect.left) / rect.width;
  if (fraction < 1 / 3) return 'before';
  return fraction > 2 / 3 ? 'after' : 'middle';
}

/**
 * Where a drag would land, shown while dragging and written on drop:
 * - `place`: a post-it or group in `columnId`, in group `groupId` (a post-it
 *   only) or none, before `beforeId` or last; `join` when it is dropped onto
 *   a group, shown as the group's ring rather than a line;
 * - `group`: a post-it dropped onto another of its column, in no group, to
 *   make a group of the two;
 * - `promote`: a Retro post-it dropped on a Lines & Veils row (spec 46 Decision 2);
 * - `column`: a Retro column dropped before `beforeId`, or last.
 */
export type DropIntent =
  | { kind: 'place'; columnId: string; groupId: string | null; beforeId: string | null; join?: boolean }
  | { kind: 'group'; withId: string }
  | { kind: 'promote'; columnId: string }
  | { kind: 'column'; beforeId: string | null };

/** What the dragged item is over, and in which part of it. */
export interface DropTarget {
  ref: DragRef;
  zone: Zone;
}

interface Found {
  card: PostIt;
  column: PostItColumn;
  retro: boolean;
}

function findCard(board: SessionZero, id: string): Found | null {
  for (const [columns, retro] of [
    [board.retro, true],
    [board.linesVeils, false],
  ] as const) {
    for (const column of columns) {
      const card = column.cards.find((c) => c.id === id);
      if (card) return { card, column, retro };
    }
  }
  return null;
}

function findGroup(board: SessionZero, id: string): { column: PostItColumn; cards: PostIt[] } | null {
  for (const column of board.retro) {
    if (column.groups.some((group) => group.id === id)) {
      return { column, cards: column.cards.filter((card) => card.groupId === id) };
    }
  }
  return null;
}

/** The ids of a group's post-its, or of a column's post-its in no group and groups. */
function containerIds(column: PostItColumn, groupId: string | null): string[] {
  if (groupId !== null) {
    return columnItems(column)
      .flatMap((item) => (item.kind === 'group' && item.group.id === groupId ? item.cards : []))
      .map((card) => card.id);
  }
  return columnItems(column).map(itemId);
}

/** What comes after `id` in `ids` once `moving` is taken out: what to drop before to land after `id`. */
function nextAfter(ids: string[], id: string, moving: string): string | null {
  const rest = ids.filter((other) => other !== moving);
  return rest[rest.indexOf(id) + 1] ?? null;
}

/**
 * A place that changes nothing (the item dropped where it already is) is
 * no place at all.
 */
function unlessUnchanged(
  intent: DropIntent & { kind: 'place' },
  ids: string[],
  moving: string,
  from: { columnId: string; groupId: string | null },
): DropIntent | null {
  if (intent.columnId !== from.columnId || intent.groupId !== from.groupId || !ids.includes(moving)) return intent;
  return intent.beforeId === (ids[ids.indexOf(moving) + 1] ?? null) ? null : intent;
}

/** Whether the viewer may move their post-it into or out of this group (spec 46d Q2). */
function mayRegroup(board: SessionZero, cards: PostIt[]): boolean {
  return board.canManage || cards.every((card) => card.mine);
}

function cardIntent(board: SessionZero, dragged: Found, target: DropTarget): DropIntent | null {
  const { card } = dragged;
  if (target.ref.kind === 'column') {
    const column = [...board.retro, ...board.linesVeils].find((c) => c.id === target.ref.id);
    if (!column) return null;
    if (column.kind !== null) {
      if (dragged.retro) return card.canPromote ? { kind: 'promote', columnId: column.id } : null;
    } else if (!dragged.retro) {
      return null;
    }
    if (!card.canPlace || !mayLeave(board, dragged)) return null;
    const ids = containerIds(column, null);
    return unlessUnchanged({ kind: 'place', columnId: column.id, groupId: null, beforeId: null }, ids, card.id, card);
  }
  if (target.ref.kind === 'group') {
    const group = findGroup(board, target.ref.id);
    if (!group || !dragged.retro || !card.canPlace) return null;
    if (target.zone === 'middle') {
      if (card.groupId === target.ref.id || card.draft || !mayRegroup(board, group.cards)) return null;
      if (!mayLeave(board, dragged)) return null;
      return { kind: 'place', columnId: group.column.id, groupId: target.ref.id, beforeId: null, join: true };
    }
    return placeAround(board, dragged, group.column, null, target.ref.id, target.zone);
  }
  const over = findCard(board, target.ref.id);
  if (!over || over.card.id === card.id) return null;
  if (!over.retro) {
    if (dragged.retro) return card.canPromote ? { kind: 'promote', columnId: over.column.id } : null;
    return card.canPlace ? placeAround(board, dragged, over.column, null, over.card.id, target.zone) : null;
  }
  if (!dragged.retro || !card.canPlace) return null;
  if (target.zone === 'middle' && card.canGroup && over.card.canGroup) {
    if (over.card.groupId !== null && over.card.groupId !== card.groupId) {
      const mates = over.column.cards.filter((c) => c.groupId === over.card.groupId);
      if (mayRegroup(board, mates) && mayLeave(board, dragged)) {
        return { kind: 'place', columnId: over.column.id, groupId: over.card.groupId, beforeId: null, join: true };
      }
      return null;
    }
    if (over.card.groupId === null && card.groupId === null && over.column.id === dragged.column.id) {
      return { kind: 'group', withId: over.card.id };
    }
  }
  return placeAround(board, dragged, over.column, over.card.groupId, over.card.id, target.zone);
}

/** Whether a post-it may leave its group, if it is in one (a Player's, only a group of theirs). */
function mayLeave(board: SessionZero, dragged: Found): boolean {
  const { card, column } = dragged;
  return card.groupId === null || mayRegroup(board, column.cards.filter((c) => c.groupId === card.groupId));
}

/** The dragged post-it just before (first or middle third) or after (last third) `aroundId` in its container. */
function placeAround(
  board: SessionZero,
  dragged: Found,
  column: PostItColumn,
  groupId: string | null,
  aroundId: string,
  zone: Zone,
): DropIntent | null {
  const { card } = dragged;
  if (groupId !== card.groupId) {
    if (!mayLeave(board, dragged)) return null;
    if (groupId !== null && (card.draft || !mayRegroup(board, column.cards.filter((c) => c.groupId === groupId)))) {
      return null;
    }
  }
  const ids = containerIds(column, groupId);
  const beforeId = zone === 'after' ? nextAfter(ids, aroundId, card.id) : aroundId;
  return unlessUnchanged({ kind: 'place', columnId: column.id, groupId, beforeId }, ids, card.id, card);
}

function groupIntent(board: SessionZero, groupId: string, target: DropTarget): DropIntent | null {
  const group = findGroup(board, groupId)!;
  const from = { columnId: group.column.id, groupId: null };
  if (target.ref.kind === 'column') {
    const column = board.retro.find((c) => c.id === target.ref.id);
    if (!column) return null;
    const ids = containerIds(column, null);
    return unlessUnchanged({ kind: 'place', columnId: column.id, groupId: null, beforeId: null }, ids, groupId, from);
  }
  let aroundId = target.ref.id;
  let column: PostItColumn | undefined;
  if (target.ref.kind === 'card') {
    const over = findCard(board, target.ref.id);
    if (!over?.retro) return null;
    column = over.column;
    aroundId = over.card.groupId ?? over.card.id;
  } else {
    column = findGroup(board, target.ref.id)?.column;
  }
  if (!column || aroundId === groupId) return null;
  const ids = containerIds(column, null);
  const beforeId = target.zone === 'after' ? nextAfter(ids, aroundId, groupId) : aroundId;
  return unlessUnchanged({ kind: 'place', columnId: column.id, groupId: null, beforeId }, ids, groupId, from);
}

function columnIntent(board: SessionZero, columnId: string, target: DropTarget): DropIntent | null {
  const ids = board.retro.map((column) => column.id);
  if (target.ref.kind !== 'column' || !ids.includes(target.ref.id) || target.ref.id === columnId) return null;
  const beforeId = target.zone === 'after' ? nextAfter(ids, target.ref.id, columnId) : target.ref.id;
  return beforeId === (ids[ids.indexOf(columnId) + 1] ?? null) ? null : { kind: 'column', beforeId };
}

/**
 * Where `dragged` lands over `target` (null: nowhere, or nothing would
 * change). The backend checks every rule again; this keeps the board from
 * offering a drop it would refuse.
 */
export function dropIntent(board: SessionZero, dragged: DragRef, target: DropTarget | null): DropIntent | null {
  if (target === null) return null;
  if (dragged.kind === 'column') return columnIntent(board, dragged.id, target);
  if (dragged.kind === 'group') return groupIntent(board, dragged.id, target);
  const found = findCard(board, dragged.id);
  return found ? cardIntent(board, found, target) : null;
}

/** The one write a drop sends. */
export function intentWrite(board: SessionZero, dragged: DragRef, intent: DropIntent): BoardWrite {
  switch (intent.kind) {
    case 'group':
      return boardWrites.group([intent.withId, dragged.id]);
    case 'promote':
      return boardWrites.promote(dragged.id, intent.columnId);
    case 'column': {
      const order = board.retro.map((column) => column.id).filter((id) => id !== dragged.id);
      const index = intent.beforeId === null ? order.length : order.indexOf(intent.beforeId);
      order.splice(index, 0, dragged.id);
      return boardWrites.reorderColumns(order);
    }
    case 'place':
      return dragged.kind === 'group'
        ? boardWrites.placeGroup(dragged.id, intent.columnId, intent.beforeId)
        : boardWrites.placeCard(dragged.id, intent.columnId, intent.groupId, intent.beforeId);
  }
}

/** `ids` with `moving` put just before `beforeId`, or last. */
function inserted(ids: string[], moving: string, beforeId: string | null): string[] {
  const rest = ids.filter((id) => id !== moving);
  const index = beforeId === null ? rest.length : rest.indexOf(beforeId);
  return [...rest.slice(0, index), moving, ...rest.slice(index)];
}

/**
 * The board as it will look once the drop's write is answered, shown at
 * once (spec 46d Decision 7): a post-it or group in its new place, the
 * columns in their new order. A new group or a promotion waits for the
 * answer (null).
 */
export function previewBoard(board: SessionZero, dragged: DragRef, intent: DropIntent): SessionZero | null {
  if (intent.kind === 'column') {
    const order = inserted(
      board.retro.map((column) => column.id),
      dragged.id,
      intent.beforeId,
    );
    return { ...board, retro: order.map((id) => board.retro.find((column) => column.id === id)!) };
  }
  if (intent.kind !== 'place') return null;
  const moving = new Set<string>([dragged.id]);
  let groups: PostItGroup[] = [];
  if (dragged.kind === 'group') {
    const source = findGroup(board, dragged.id)!;
    source.cards.forEach((card) => moving.add(card.id));
    groups = source.column.groups.filter((group) => group.id === dragged.id);
  }
  const taken = [...board.retro, ...board.linesVeils].flatMap((column) =>
    column.cards.filter((card) => moving.has(card.id)),
  );
  const strip = (column: PostItColumn): PostItColumn => ({
    ...column,
    cards: column.cards.filter((card) => !moving.has(card.id)),
    groups: column.groups.filter((group) => group.id !== dragged.id),
  });
  const place = (column: PostItColumn): PostItColumn => {
    if (column.id !== intent.columnId) return strip(column);
    const ids = inserted(containerIds(column, intent.groupId), dragged.id, intent.beforeId);
    const positions = new Map(ids.map((id, index) => [id, index]));
    const moved = taken.map((card) =>
      card.id === dragged.id && dragged.kind === 'card'
        ? { ...card, columnId: column.id, groupId: intent.groupId }
        : { ...card, columnId: column.id },
    );
    const cards = [...strip(column).cards, ...moved].map((card) =>
      positions.has(card.id) && card.groupId === intent.groupId ? { ...card, position: positions.get(card.id)! } : card,
    );
    const placedGroups = [...strip(column).groups, ...groups].map((group) =>
      positions.has(group.id) ? { ...group, position: positions.get(group.id)! } : group,
    );
    return { ...column, cards, groups: placedGroups };
  };
  return { ...board, retro: board.retro.map(place), linesVeils: board.linesVeils.map(place) };
}

/**
 * Whether the drop line shows just before `beforeId` (null: at the end) in
 * a column's post-its in no group (`groupId` null) or in a group.
 */
export function showsLine(
  intent: DropIntent | null,
  columnId: string,
  groupId: string | null,
  beforeId: string | null,
): boolean {
  return (
    intent?.kind === 'place' &&
    !intent.join &&
    intent.columnId === columnId &&
    intent.groupId === groupId &&
    intent.beforeId === beforeId
  );
}
