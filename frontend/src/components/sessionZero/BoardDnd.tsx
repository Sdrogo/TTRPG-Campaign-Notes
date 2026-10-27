import type { CSSProperties, ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { Paper, Text } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { useTranslation } from 'react-i18next';
import { columnColor } from '../../lib/sessionZero';
import type { Axis, DragRef } from '../../lib/sessionZeroDnd';
import { useBoard } from './boardContext';
import {
  DROP_LINE_ID,
  DndStateContext,
  boardCollisions,
  dragAnnouncements,
  dragLabel,
  useBoardDrag,
  type DropData,
} from './boardDrag';

/** The dragged item, lifted: a post-it, a group or a column, with its column's colour. */
export function DragPreview({ dragged }: { dragged: DragRef }) {
  const { t } = useTranslation();
  const { board } = useBoard();
  const column = board.retro.concat(board.linesVeils).find((c) =>
    dragged.kind === 'column'
      ? c.id === dragged.id
      : dragged.kind === 'group'
        ? c.groups.some((g) => g.id === dragged.id)
        : c.cards.some((card) => card.id === dragged.id),
  );
  const count =
    dragged.kind === 'group' ? (column?.cards.filter((card) => card.groupId === dragged.id).length ?? 0) : 0;
  return (
    <Paper
      withBorder
      p="xs"
      className="sz-post-it sz-drag-overlay"
      style={{ '--sz-color': column ? columnColor(column) : undefined } as CSSProperties}
    >
      <Text size="sm" fw={dragged.kind === 'card' ? undefined : 700} lineClamp={4} style={{ overflowWrap: 'anywhere' }}>
        {dragLabel(board, dragged, t)}
      </Text>
      {dragged.kind === 'group' && (
        <Text size="xs" c="dimmed">
          {t('sessionZero.groups.count', { count })}
        </Text>
      )}
    </Paper>
  );
}

/**
 * Drag and drop on the Session 0 boards (spec 46d Decision 7): post-its,
 * groups and columns, with the mouse, a long press on a phone (so a swipe
 * still scrolls), or the keyboard (Space, arrows, Space; Esc cancels).
 * Without motion preferences nothing slides back after a drop.
 */
export function BoardDnd({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { board, act } = useBoard();
  const reduced = useReducedMotion();
  const { state, handlers } = useBoardDrag(board, act);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollisions}
      // The drop line opens a gap: what is under the pointer is measured again as it does.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      accessibility={{
        announcements: dragAnnouncements(board, t),
        screenReaderInstructions: { draggable: t('sessionZero.dnd.instructions') },
      }}
      {...handlers}
    >
      <DndStateContext.Provider value={state}>{children}</DndStateContext.Provider>
      <DragOverlay dropAnimation={reduced ? null : undefined}>
        {state.active && <DragPreview dragged={state.active} />}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * Where a dragged item would land, between two post-its, groups or
 * columns; `end` puts it after a Lines & Veils post-it rather than before.
 */
export function DropLine({ axis = 'y', end = false }: { axis?: Axis; end?: boolean }) {
  const data: DropData = { ref: null, axis };
  const { setNodeRef } = useDroppable({ id: DROP_LINE_ID, data });
  return (
    <div
      ref={setNodeRef}
      className={axis === 'y' ? 'sz-drop-line' : 'sz-drop-line sz-drop-line-x'}
      data-end={end || undefined}
      aria-hidden
    />
  );
}
