import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PostItCard } from '../../../components/sessionZero/PostItCard';
import { boardWrites } from '../../../lib/sessionZero';
import { rawPostIt } from '../../fixtures';
import { column, postIt, renderBoard } from './harness';

vi.mock('../../../components/comments/EmojiPicker', () => ({
  EmojiPicker: ({ onSelect }: { onSelect: (emoji: string) => void }) => (
    <button onClick={() => onSelect('🎲')}>scegli 🎲</button>
  ),
}));

const card = () => screen.getByRole('article');

describe('PostItCard', () => {
  it("shows the viewer's own signed post-it, which they edit", async () => {
    const { act, user } = renderBoard(<PostItCard postIt={postIt()} column={column()} onLinesVeils={false} />);
    expect(screen.getByRole('article', { name: 'Post-it di Tu' })).toHaveTextContent('Niente ragni');
    expect(card()).not.toHaveAttribute('draggable', 'true');

    await user.click(screen.getByRole('button', { name: 'Azioni del post-it' }));
    expect(screen.queryByRole('menuitem', { name: 'Pubblica' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('menuitem', { name: 'Modifica' }));
    const text = screen.getByRole('textbox', { name: 'Testo del post-it' });
    await user.clear(text);
    await user.type(text, '  Niente ragni giganti ');
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(act).toHaveBeenCalledWith(boardWrites.editPostIt('card-1', 'Niente ragni giganti'));
    expect(screen.getByRole('article')).toBeInTheDocument();
  });

  it('drops an edit on cancel', async () => {
    const { act, user } = renderBoard(<PostItCard postIt={postIt()} column={column()} onLinesVeils={false} />);
    await user.click(screen.getByRole('button', { name: 'Azioni del post-it' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Modifica' }));
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(act).not.toHaveBeenCalled();
    expect(card()).toHaveTextContent('Niente ragni');
  });

  it('deletes the post-it', async () => {
    const { act, user } = renderBoard(<PostItCard postIt={postIt()} column={column()} onLinesVeils={false} />);
    await user.click(screen.getByRole('button', { name: 'Azioni del post-it' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Elimina' }));
    expect(act).toHaveBeenCalledWith(boardWrites.deletePostIt('card-1'));
  });

  // Decisions 1 and 7: a draft is published signed or anonymous; spec 46c
  // Decision 8: from a button on the post-it itself, or from its menu.
  it('publishes a draft anonymously after asking', async () => {
    const { act, user } = renderBoard(
      <PostItCard
        postIt={postIt({ draft: true, can_publish: true, can_react: false })}
        column={column()}
        onLinesVeils={false}
      />,
    );
    expect(screen.getByText('Bozza')).toBeInTheDocument();
    expect(card()).toHaveAttribute('data-draft');

    await user.click(screen.getByRole('button', { name: 'Azioni del post-it' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Pubblica' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Annulla' }));
    expect(act).not.toHaveBeenCalled();

    await user.click(within(card()).getByRole('button', { name: 'Pubblica' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('switch', { name: /Pubblica in anonimo/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Pubblica' }));
    expect(act).toHaveBeenCalledWith(boardWrites.publish('card-1', true), expect.any(Function));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("names someone else's author, hides an anonymous one, and marks the viewer's own anonymous post-it", () => {
    renderBoard(
      <>
        <PostItCard postIt={postIt({ id: 'a', author_id: 'user-2', mine: false })} column={column()} onLinesVeils={false} />
        <PostItCard postIt={postIt({ id: 'b', author_id: null, mine: false, anonymous: true })} column={column()} onLinesVeils={false} />
        <PostItCard postIt={postIt({ id: 'c', anonymous: true, from_retro: true })} column={column({ kind: 'must' })} onLinesVeils />
      </>,
    );
    const [other, anonymous, own] = screen.getAllByRole('article');
    expect(other).toHaveAccessibleName('Post-it di Bianca');
    expect(anonymous).toHaveAccessibleName('Post-it di Anonimo');
    expect(own).toHaveAccessibleName('Post-it di Tu');
    expect(own).toHaveTextContent('Anonimo');
    expect(own).toHaveTextContent('dalla Retro');
  });

  // Decision 8: the Master promotes a Retro post-it to any Lines & Veils column.
  it('promotes a Retro post-it from its menu, or by dragging it', async () => {
    const { act, user } = renderBoard(
      <PostItCard postIt={postIt({ can_edit: false, can_delete: false, can_promote: true })} column={column()} onLinesVeils={false} />,
    );
    await user.click(screen.getByRole('button', { name: 'Azioni del post-it' }));
    expect(await screen.findByRole('menuitem', { name: 'Promuovi in Must' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Promuovi in Linee' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Promuovi in Veli' }));
    expect(act).toHaveBeenCalledWith(boardWrites.promote('card-1', 'lv-veils'));

    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
    expect(card()).toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(card(), { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'application/x-exlibris-post-it',
      JSON.stringify({ id: 'card-1', action: 'promote', columnId: 'col-1' }),
    );
    expect(dataTransfer.effectAllowed).toBe('copyMove');
  });

  // Decision 16: a Lines & Veils post-it moves to the other two columns.
  it('moves a Lines & Veils post-it to another column', async () => {
    const { act, user } = renderBoard(
      <PostItCard postIt={postIt({ column_id: 'lv-must', can_move: true })} column={column({ kind: 'must' })} onLinesVeils />,
    );
    await user.click(screen.getByRole('button', { name: 'Azioni del post-it' }));
    expect(await screen.findByRole('menuitem', { name: 'Sposta in Linee' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Sposta in Must' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Sposta in Veli' }));
    expect(act).toHaveBeenCalledWith(boardWrites.move('card-1', 'lv-veils'));

    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(card(), { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'application/x-exlibris-post-it',
      JSON.stringify({ id: 'card-1', action: 'move', columnId: 'lv-must' }),
    );
    expect(dataTransfer.effectAllowed).toBe('move');
  });

  it('reacts with a chip or the picker', async () => {
    const reactions = [{ emoji: '👍', count: 1, reacted_by_me: true, user_ids: ['user-1'] }];
    const { act, user } = renderBoard(<PostItCard postIt={postIt({ reactions })} column={column()} onLinesVeils={false} />);
    await user.click(screen.getByRole('button', { name: /^👍/ }));
    expect(act).toHaveBeenCalledWith(boardWrites.react('card-1', '👍', false));
    await user.click(screen.getByRole('button', { name: 'Aggiungi una reazione' }));
    await user.click(await screen.findByRole('button', { name: 'scegli 🎲' }));
    expect(act).toHaveBeenCalledWith(boardWrites.react('card-1', '🎲', true));
  });

  // Spec 22b: in "View as" nothing writes, so no menu, no picker, no drag.
  it('only shows the post-it while the Master previews the Room', () => {
    const reactions = [{ emoji: '👍', count: 1, reacted_by_me: false, user_ids: ['user-2'] }];
    renderBoard(<PostItCard postIt={postIt({ reactions, can_promote: true })} column={column()} onLinesVeils={false} />, {
      writable: false,
    });
    expect(screen.queryByRole('button', { name: 'Azioni del post-it' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aggiungi una reazione' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^👍/ })).toBeDisabled();
    expect(card()).not.toHaveAttribute('draggable', 'true');
  });

  it('shows no reactions row on a post-it that takes none and has none', () => {
    renderBoard(
      <PostItCard postIt={postIt({ can_react: false, can_edit: false, can_delete: false })} column={column()} onLinesVeils={false} />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // Spec 46c Decision 9: the Master drops a post-it of the same column on another to group them.
  it('groups the post-it dropped on it from the same column', () => {
    const { act } = renderBoard(
      <PostItCard postIt={postIt({ can_group: true })} column={column()} onLinesVeils={false} />,
    );
    const drag = (dragged: object) => {
      const dataTransfer = {
        types: ['application/x-exlibris-post-it'],
        getData: () => JSON.stringify(dragged),
      };
      fireEvent.dragOver(card(), { dataTransfer });
      expect(card()).toHaveAttribute('data-drop-over');
      fireEvent.drop(card(), { dataTransfer });
      expect(card()).not.toHaveAttribute('data-drop-over');
    };
    drag({ id: 'card-1', action: 'promote', columnId: 'col-1' });
    drag({ id: 'card-9', action: 'promote', columnId: 'col-2' });
    drag({ id: 'card-9', action: 'move', columnId: 'col-1' });
    expect(act).not.toHaveBeenCalled();
    drag({ id: 'card-2', action: 'promote', columnId: 'col-1' });
    expect(act).toHaveBeenCalledWith(boardWrites.group(['card-1', 'card-2']));

    fireEvent.dragOver(card(), { dataTransfer: { types: ['text/plain'] } });
    expect(card()).not.toHaveAttribute('data-drop-over');
    fireEvent.dragLeave(card());
    fireEvent.drop(card(), { dataTransfer: { types: ['text/plain'] } });
    expect(act).toHaveBeenCalledTimes(1);
  });

  it('takes no drop where it cannot be grouped', () => {
    renderBoard(<PostItCard postIt={postIt()} column={column()} onLinesVeils={false} />);
    fireEvent.dragOver(card(), { dataTransfer: { types: ['application/x-exlibris-post-it'] } });
    expect(card()).not.toHaveAttribute('data-drop-over');
  });

  // "Group with…" lists the column's other groups and lone post-its, not its own group.
  it('groups with another post-it or group of the column from its menu, or takes it out', async () => {
    const grouped = { can_group: true, group_id: 'g-1' };
    const own = column({
      groups: [
        { id: 'g-1', title: null },
        { id: 'g-2', title: 'Draghi' },
      ],
      cards: [
        rawPostIt(grouped),
        rawPostIt({ ...grouped, id: 'card-2', body: 'Stessa' }),
        rawPostIt({ id: 'card-3', can_group: true, group_id: 'g-2', body: 'Viverne' }),
        rawPostIt({ id: 'card-4', can_group: true, group_id: 'g-2', body: 'Draghi' }),
        rawPostIt({ id: 'card-5', can_group: true, body: 'Basilischi' }),
        rawPostIt({ id: 'card-6', can_group: false, draft: true, body: 'Bozza' }),
        rawPostIt({ id: 'card-7', can_group: true, group_id: 'g-3', body: 'Senza gruppo noto' }),
      ],
    });
    const { act, user } = renderBoard(
      <PostItCard postIt={own.cards[0]} column={own} onLinesVeils={false} />,
    );

    await user.click(screen.getByRole('button', { name: 'Azioni del post-it' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Togli dal gruppo' }));
    expect(act).toHaveBeenCalledWith(boardWrites.ungroup('card-1'));

    await user.click(screen.getByRole('button', { name: 'Azioni del post-it' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Raggruppa con…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Raggruppa con…' });
    const choices = within(dialog).getAllByRole('button').filter((b) => b.textContent !== '');
    expect(choices.map((b) => b.textContent)).toEqual([
      'Draghi2 post-it',
      'Basilischi',
      'Gruppo1 post-it',
    ]);
    await user.click(choices[0]);
    expect(act).toHaveBeenCalledWith(boardWrites.group(['card-3', 'card-1']), expect.any(Function));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Azioni del post-it' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Raggruppa con…' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Azioni del post-it' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Raggruppa con…' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Basilischi/ }));
    expect(act).toHaveBeenLastCalledWith(boardWrites.group(['card-5', 'card-1']), expect.any(Function));
  });

  it('offers no grouping when the column has nothing to group with', async () => {
    const { user } = renderBoard(
      <PostItCard postIt={postIt({ can_group: true })} column={column()} onLinesVeils={false} />,
    );
    await user.click(screen.getByRole('button', { name: 'Azioni del post-it' }));
    await screen.findByRole('menuitem', { name: 'Elimina' });
    expect(screen.queryByRole('menuitem', { name: 'Raggruppa con…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Togli dal gruppo' })).not.toBeInTheDocument();
  });
});
