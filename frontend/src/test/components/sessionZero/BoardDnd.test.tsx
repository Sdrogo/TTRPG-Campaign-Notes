import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BoardDnd, DragPreview } from '../../../components/sessionZero/BoardDnd';
import { PostItCard } from '../../../components/sessionZero/PostItCard';
import { rawPostIt, rawPostItColumn } from '../../fixtures';
import { matchMediaQueries } from '../../media';
import { postIt, column, renderBoard } from './harness';

const board = {
  can_manage: true,
  retro: [
    rawPostItColumn({
      groups: [{ id: 'g-1', title: 'Draghi', position: 1 }],
      cards: [
        rawPostIt({ body: 'Niente ragni' }),
        rawPostIt({ id: 'card-2', body: 'Draghi rossi', group_id: 'g-1' }),
        rawPostIt({ id: 'card-3', body: 'Draghi blu', group_id: 'g-1', position: 1 }),
      ],
    }),
  ],
};

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

// Spec 46d Decision 7: what the pointer carries while dragging.
describe('DragPreview', () => {
  it('lifts a post-it with its text, in its column colour', () => {
    renderBoard(<DragPreview dragged={{ kind: 'card', id: 'card-1' }} />, { board });
    const preview = screen.getByText('Niente ragni').closest('.sz-drag-overlay') as HTMLElement;
    expect(preview.style.getPropertyValue('--sz-color')).toBe('var(--mantine-color-green-5)');
  });

  it('lifts a group with its title and count, and a column with its title', () => {
    renderBoard(
      <>
        <DragPreview dragged={{ kind: 'group', id: 'g-1' }} />
        <DragPreview dragged={{ kind: 'column', id: 'col-1' }} />
      </>,
      { board },
    );
    expect(screen.getByText('Draghi')).toBeInTheDocument();
    expect(screen.getByText('2 post-it')).toBeInTheDocument();
    expect(screen.getByText('Lo vogliamo al tavolo')).toBeInTheDocument();
  });

  it('shows a group no longer on the board without a colour', () => {
    renderBoard(<DragPreview dragged={{ kind: 'group', id: 'gone' }} />, { board });
    const preview = screen.getByText('0 post-it').closest('.sz-drag-overlay') as HTMLElement;
    expect(preview.style.getPropertyValue('--sz-color')).toBe('');
  });
});

describe('BoardDnd', () => {
  it('drops without sliding back for someone who prefers less motion', async () => {
    restore = matchMediaQueries(['(prefers-reduced-motion: reduce)']);
    const { user } = renderBoard(
      <BoardDnd>
        <PostItCard postIt={postIt({ can_place: true })} column={column()} onLinesVeils={false} />
      </BoardDnd>,
      { board },
    );
    screen.getByRole('article').focus();
    await user.keyboard(' ');
    await waitFor(() => expect(document.querySelector('.sz-drag-overlay')).toBeInTheDocument());
    await user.keyboard(' ');
    await waitFor(() => expect(document.querySelector('.sz-drag-overlay')).not.toBeInTheDocument());
  });
});
