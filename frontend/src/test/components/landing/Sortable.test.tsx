import type { ComponentProps } from 'react';
import { screen } from '@testing-library/react';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DragHandle, SortableItem, SortableList } from '../../../components/landing/Sortable';
import { renderWithProviders } from '../../utils';

let dragEnd: ((event: DragEndEvent) => void) | undefined;

vi.mock('@dnd-kit/core', async (original) => {
  const actual = await original<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    DndContext: (props: ComponentProps<typeof actual.DndContext>) => {
      dragEnd = props.onDragEnd;
      return <actual.DndContext {...props} />;
    },
  };
});
vi.mock('@dnd-kit/sortable', async (original) => {
  const actual = await original<typeof import('@dnd-kit/sortable')>();
  return { ...actual, useSortable: vi.fn(actual.useSortable) };
});

function List({ onMove, layout }: { onMove: (ids: string[]) => void; layout?: 'grid' | 'vertical' | 'horizontal' }) {
  return (
    <SortableList ids={['a', 'b', 'c']} onMove={onMove} layout={layout}>
      {['a', 'b', 'c'].map((id) => (
        <SortableItem key={id} id={id} disabled={id === 'c'}>
          {({ ref, style }) => (
            <div ref={ref} style={style} data-testid={`item-${id}`}>
              <DragHandle label={`Sposta ${id}`} />
            </div>
          )}
        </SortableItem>
      ))}
    </SortableList>
  );
}

const drop = (active: string, over: string | null) =>
  dragEnd!({ active: { id: active }, over: over === null ? null : { id: over } } as unknown as DragEndEvent);

beforeEach(() => {
  dragEnd = undefined;
});

describe('the sortable lists', () => {
  it('moves an item where it is dropped, and ignores drops that move nothing', () => {
    const onMove = vi.fn();
    renderWithProviders(<List onMove={onMove} layout="grid" />);
    expect(screen.getByRole('button', { name: 'Sposta a' })).toHaveAttribute('aria-roledescription', 'sortable');
    drop('a', null);
    drop('a', 'a');
    drop('a', 'zzz');
    drop('zzz', 'a');
    expect(onMove).not.toHaveBeenCalled();
    drop('a', 'c');
    expect(onMove).toHaveBeenCalledWith(['b', 'c', 'a']);
  });

  it('moves the dragged item with its transform', () => {
    const real = vi.mocked(useSortable).getMockImplementation()!;
    vi.mocked(useSortable).mockImplementation((args) => ({ ...real(args), transform: { x: 1.4, y: 2.6, scaleX: 1, scaleY: 1 }, isDragging: true }));
    renderWithProviders(<List onMove={vi.fn()} />);
    expect(screen.getByTestId('item-a').style.transform).toBe('translate3d(1px, 3px, 0)');
    expect(screen.getByTestId('item-a').style.zIndex).toBe('5');
    vi.mocked(useSortable).mockImplementation(real);
  });

  it('has no handle outside a sortable item', () => {
    renderWithProviders(
      <DndContext>
        <DragHandle label="Sposta" />
      </DndContext>,
    );
    expect(screen.queryByRole('button', { name: 'Sposta' })).not.toBeInTheDocument();
  });
});
