import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BoardDnd } from '../../../components/sessionZero/BoardDnd';
import { PostItGroup } from '../../../components/sessionZero/PostItGroup';
import { boardWrites } from '../../../lib/sessionZero';
import { rawPostIt, rawPostItColumn } from '../../fixtures';
import { column, renderBoard } from './harness';

const master = { board: { can_manage: true } };

function groupedRaw(title: string | null) {
  return {
    groups: [{ id: 'g-1', title, position: 0 }],
    cards: [
      rawPostIt({ id: 'a', body: 'Draghi rossi', group_id: 'g-1', can_group: true }),
      rawPostIt({ id: 'b', body: 'Draghi blu', group_id: 'g-1', can_group: true, position: 1 }),
    ],
  };
}

function grouped(title: string | null) {
  return column(groupedRaw(title));
}

// Spec 46c Decision 9.
describe('PostItGroup', () => {
  it('frames its post-its under its title and count', () => {
    const own = grouped('Draghi');
    renderBoard(<PostItGroup groupId="g-1" column={own} cards={own.cards} open />);
    const group = screen.getByRole('group', { name: 'Draghi' });
    expect(group).toHaveTextContent('2 post-it');
    expect(within(group).getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Azioni del gruppo/ })).not.toBeInTheDocument();
  });

  it('is called "Group" without a title', () => {
    const own = grouped(null);
    renderBoard(<PostItGroup groupId="g-1" column={own} cards={own.cards} open />);
    expect(screen.getByRole('group', { name: 'Gruppo' })).toBeInTheDocument();
  });

  it('lets the Master title the group, or clear its title', async () => {
    const own = grouped('Draghi');
    const { act, user } = renderBoard(<PostItGroup groupId="g-1" column={own} cards={own.cards} open />, master);
    const rename = async () => {
      await user.click(screen.getByRole('button', { name: 'Azioni del gruppo Draghi' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Rinomina gruppo' }));
      return screen.getByRole('textbox', { name: 'Titolo del gruppo' });
    };

    const input = await rename();
    expect(input).toHaveValue('Draghi');
    await user.type(input, '{Escape}');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(act).not.toHaveBeenCalled();

    const again = await rename();
    await user.clear(again);
    await user.type(again, ' Rettili {Enter}');
    expect(act).toHaveBeenCalledWith(boardWrites.renameGroup('g-1', ' Rettili '));
    expect(boardWrites.renameGroup('g-1', ' Rettili ').json).toEqual({ title: 'Rettili' });

    fireEvent.blur(await rename());
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('starts an untitled group with an empty title', async () => {
    const own = grouped(null);
    const { user } = renderBoard(<PostItGroup groupId="g-1" column={own} cards={own.cards} open />, master);
    await user.click(screen.getByRole('button', { name: 'Azioni del gruppo Gruppo' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Rinomina gruppo' }));
    expect(screen.getByRole('textbox', { name: 'Titolo del gruppo' })).toHaveValue('');
    expect(boardWrites.renameGroup('g-1', '  ').json).toEqual({ title: null });
  });

  it('lets the Master dissolve the group', async () => {
    const own = grouped('Draghi');
    const { act, user } = renderBoard(<PostItGroup groupId="g-1" column={own} cards={own.cards} open />, master);
    await user.click(screen.getByRole('button', { name: 'Azioni del gruppo Draghi' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sciogli gruppo' }));
    expect(act).toHaveBeenCalledWith(boardWrites.ungroupAll('g-1'));
  });

  it('is read-only on a closed round', () => {
    const own = grouped('Draghi');
    renderBoard(<PostItGroup groupId="g-1" column={own} cards={own.cards} open={false} />, master);
    expect(screen.queryByRole('button', { name: /Azioni del gruppo/ })).not.toBeInTheDocument();
  });

  // Spec 46d Decision 7: a post-it dragged onto the group joins it, at its end.
  it('rings as the group a drag would join', () => {
    const own = grouped('Draghi');
    renderBoard(<PostItGroup groupId="g-1" column={own} cards={own.cards} open />, {
      dnd: {
        active: { kind: 'card', id: 'x' },
        intent: { kind: 'place', columnId: 'col-1', groupId: 'g-1', beforeId: null, join: true },
      },
    });
    const group = screen.getByRole('group', { name: 'Draghi' });
    expect(group).toHaveAttribute('data-group-target');
    expect(within(group).getByText('Raggruppa')).toBeInTheDocument();
    expect(group.querySelector('.sz-drop-line')).not.toBeInTheDocument();
  });

  it('shows a line between its post-its, or after the last', () => {
    const own = grouped('Draghi');
    const at = (beforeId: string | null) => ({
      dnd: {
        active: { kind: 'card' as const, id: 'x' },
        intent: { kind: 'place' as const, columnId: 'col-1', groupId: 'g-1', beforeId },
      },
    });
    renderBoard(<PostItGroup groupId="g-1" column={own} cards={own.cards} open />, at('b'));
    const group = screen.getByRole('group', { name: 'Draghi' });
    expect(group).not.toHaveAttribute('data-group-target');
    expect(group.querySelector('.sz-drop-line')?.nextElementSibling).toHaveTextContent('Draghi blu');
  });

  it('shows the line after its last post-it', () => {
    const own = grouped('Draghi');
    renderBoard(<PostItGroup groupId="g-1" column={own} cards={own.cards} open />, {
      dnd: {
        active: { kind: 'card', id: 'x' },
        intent: { kind: 'place', columnId: 'col-1', groupId: 'g-1', beforeId: null },
      },
    });
    const lines = screen.getByRole('group', { name: 'Draghi' }).querySelectorAll('.sz-drop-line');
    expect(lines).toHaveLength(1);
    expect(lines[0].nextElementSibling).toBeNull();
  });

  // The Master picks the group up by its heading, with the keyboard too; not from its "⋮".
  it('is picked up by its heading', async () => {
    const own = grouped('Draghi');
    const { user } = renderBoard(
      <BoardDnd>
        <PostItGroup groupId="g-1" column={own} cards={own.cards} open />
      </BoardDnd>,
      { board: { can_manage: true, retro: [rawPostItColumn(groupedRaw('Draghi'))] } },
    );
    const group = screen.getByRole('group', { name: 'Draghi' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Azioni del gruppo Draghi' }), { key: ' ', code: 'Space' });
    expect(group).not.toHaveAttribute('data-dragging');
    (group.querySelector('[tabindex="0"]') as HTMLElement).focus();
    await user.keyboard(' ');
    await waitFor(() => expect(group).toHaveAttribute('data-dragging'));
    expect(document.querySelector('.sz-drag-overlay')).toHaveTextContent('2 post-it');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(group).not.toHaveAttribute('data-dragging'));
  });
});
