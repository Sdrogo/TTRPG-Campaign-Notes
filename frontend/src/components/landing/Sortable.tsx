import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  horizontalListSortingStrategy,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ActionIcon } from '@mantine/core';
import { DotsSixVerticalIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

const STRATEGIES = { grid: rectSortingStrategy, vertical: verticalListSortingStrategy, horizontal: horizontalListSortingStrategy };

interface SortableListProps {
  ids: string[];
  /** The ids in their new order, after a drop that moved one. */
  onMove: (ids: string[]) => void;
  layout?: keyof typeof STRATEGIES;
  children: ReactNode;
}

/**
 * A list the Master reorders by drag (spec 55 Decisions 12-13): with the
 * mouse, a long press on a phone (so a swipe still scrolls), or the
 * keyboard (Space, arrows, Space; Esc cancels), as Session 0's boards.
 * Only a `DragHandle` starts a drag, so the cards' links still work.
 */
export function SortableList({ ids, onMove, layout = 'vertical', children }: SortableListProps) {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onMove(arrayMove(ids, from, to));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{ screenReaderInstructions: { draggable: t('roomLanding.edit.dragInstructions') } }}
    >
      <SortableContext items={ids} strategy={STRATEGIES[layout]}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

interface HandleContextValue {
  attributes: ReturnType<typeof useSortable>['attributes'];
  listeners: ReturnType<typeof useSortable>['listeners'];
  setActivatorNodeRef: ReturnType<typeof useSortable>['setActivatorNodeRef'];
}

const HandleContext = createContext<HandleContextValue | null>(null);

/**
 * One item of a `SortableList`: `children` gets the ref and style to put on
 * the moving element; a `DragHandle` inside it starts the drag.
 */
export function SortableItem({
  id,
  disabled = false,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: (props: { ref: (node: HTMLElement | null) => void; style: CSSProperties; dragging: boolean }) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  const style: CSSProperties = {
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 5 : undefined,
    position: 'relative',
  };
  return (
    <HandleContext.Provider value={{ attributes, listeners, setActivatorNodeRef }}>
      {children({ ref: setNodeRef, style, dragging: isDragging })}
    </HandleContext.Provider>
  );
}

/** The ⠿ that drags its `SortableItem`, labelled for screen readers. */
export function DragHandle({ label, size = 'sm' }: { label: string; size?: 'xs' | 'sm' | 'md' }) {
  const handle = useContext(HandleContext);
  if (!handle) return null;
  const { attributes, listeners, setActivatorNodeRef } = handle;
  return (
    <ActionIcon
      ref={setActivatorNodeRef}
      variant="subtle"
      color="gray"
      size={size}
      aria-label={label}
      title={label}
      style={{ cursor: 'grab', touchAction: 'none' }}
      {...attributes}
      {...listeners}
    >
      <DotsSixVerticalIcon size={16} weight="bold" />
    </ActionIcon>
  );
}
