import { createContext, useContext, useState } from 'react';
import type {
  Announcements,
  CollisionDetection,
  DragEndEvent,
  DragMoveEvent,
  DragStartEvent,
  UniqueIdentifier,
} from '@dnd-kit/core';
import type { TFunction } from 'i18next';
import {
  dropIntent,
  intentWrite,
  parseDragKey,
  previewBoard,
  zoneOf,
  type Axis,
  type DragRef,
  type DropIntent,
} from '../../lib/sessionZeroDnd';
import type { SessionZero } from '../../types/sessionZero';
import type { BoardContextValue } from './boardContext';

/** What is being dragged and where it would land (spec 46d Decision 7). */
export interface DndState {
  active: DragRef | null;
  intent: DropIntent | null;
}

const IDLE: DndState = { active: null, intent: null };

export const DndStateContext = createContext<DndState>(IDLE);

/** The drag in progress, for the post-its, groups and columns to show where it lands. */
export function useDndState(): DndState {
  return useContext(DndStateContext);
}

/**
 * What a droppable carries: what it is, and which way its post-its run.
 * The drop line itself carries no `ref`: over it, the drop stays where the
 * line shows, so the gap it opens never moves it.
 */
export interface DropData {
  ref: DragRef | null;
  axis: Axis;
}

/** The drop line's droppable id: there is one at a time. */
export const DROP_LINE_ID = 'drop-line';

/**
 * The droppable under the pointer (the dragged item's middle with the
 * keyboard): the smallest that holds it, so a post-it wins over its group
 * and its column. A column dragged only meets columns.
 */
export const boardCollisions: CollisionDetection = ({
  active,
  droppableContainers,
  droppableRects,
  pointerCoordinates,
  collisionRect,
}) => {
  const point = pointerCoordinates ?? {
    x: collisionRect.left + collisionRect.width / 2,
    y: collisionRect.top + collisionRect.height / 2,
  };
  const columnsOnly = parseDragKey(active.id).kind === 'column';
  let best: { id: UniqueIdentifier; area: number } | null = null;
  for (const container of droppableContainers) {
    const rect = droppableRects.get(container.id);
    if (!rect || (columnsOnly && parseDragKey(container.id).kind !== 'column')) continue;
    if (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) continue;
    const area = rect.width * rect.height;
    if (best === null || area < best.area) best = { id: container.id, area };
  }
  return best ? [{ id: best.id, data: { value: best.area } }] : [];
};

/** Where the pointer is: where the drag started plus how far it went; the item's middle with the keyboard. */
function pointerOf(event: DragMoveEvent): { x: number; y: number } {
  const start = event.activatorEvent;
  if (start instanceof MouseEvent) return { x: start.clientX + event.delta.x, y: start.clientY + event.delta.y };
  if (typeof TouchEvent !== 'undefined' && start instanceof TouchEvent && start.touches.length > 0) {
    return { x: start.touches[0].clientX + event.delta.x, y: start.touches[0].clientY + event.delta.y };
  }
  const rect = event.active.rect.current.translated!;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function intentOf(board: SessionZero, event: DragMoveEvent, current: DropIntent | null): DropIntent | null {
  const { over } = event;
  if (!over) return null;
  const data = over.data.current as DropData;
  if (data.ref === null) return current;
  return dropIntent(board, parseDragKey(event.active.id), {
    ref: data.ref,
    zone: zoneOf(over.rect, pointerOf(event), data.axis),
  });
}

/**
 * The drag's handlers and state: where it would land while it moves, and
 * on drop the one write, the board shown at once as it will look (spec 46d
 * Decision 7) and put back by the page if the write fails.
 */
export function useBoardDrag(board: SessionZero, act: BoardContextValue['act']) {
  const [state, setState] = useState<DndState>(IDLE);
  return {
    state,
    handlers: {
      onDragStart: (event: DragStartEvent) => setState({ active: parseDragKey(event.active.id), intent: null }),
      onDragMove: (event: DragMoveEvent) => {
        const intent = intentOf(board, event, state.intent);
        if (JSON.stringify(intent) !== JSON.stringify(state.intent)) setState({ ...state, intent });
      },
      onDragEnd: (event: DragEndEvent) => {
        const intent = intentOf(board, event, state.intent);
        setState(IDLE);
        if (!intent) return;
        const dragged = parseDragKey(event.active.id);
        act(intentWrite(board, dragged, intent), undefined, previewBoard(board, dragged, intent) ?? undefined);
      },
      onDragCancel: () => setState(IDLE),
    },
  };
}

/** How a dragged or hovered item is named to a screen reader: a post-it's text, a group's or column's title. */
export function dragLabel(board: SessionZero, ref: DragRef, t: TFunction): string {
  const columns = [...board.retro, ...board.linesVeils];
  if (ref.kind === 'column') {
    const column = columns.find((c) => c.id === ref.id);
    return column?.kind ? t(`sessionZero.kinds.${column.kind}`) : (column?.title ?? '');
  }
  if (ref.kind === 'group') {
    const group = columns.flatMap((c) => c.groups).find((g) => g.id === ref.id);
    return group?.title ?? t('sessionZero.groups.untitled');
  }
  return columns.flatMap((c) => c.cards).find((card) => card.id === ref.id)?.body ?? '';
}

/** What a screen reader hears as a drag goes, in the viewer's language. */
export function dragAnnouncements(board: SessionZero, t: TFunction): Announcements {
  const name = (id: UniqueIdentifier) => dragLabel(board, parseDragKey(id), t);
  return {
    onDragStart: ({ active }) => t('sessionZero.dnd.pickedUp', { name: name(active.id) }),
    onDragOver: ({ over }) =>
      over ? t('sessionZero.dnd.over', { name: name(over.id) }) : t('sessionZero.dnd.noTarget'),
    onDragEnd: ({ active }) => t('sessionZero.dnd.dropped', { name: name(active.id) }),
    onDragCancel: ({ active }) => t('sessionZero.dnd.cancelled', { name: name(active.id) }),
  };
}
