import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PostItCard } from '../../../components/sessionZero/PostItCard';
import { boardWrites } from '../../../lib/sessionZero';
import { postIt, renderBoard } from './harness';

vi.mock('../../../components/comments/EmojiPicker', () => ({
  EmojiPicker: ({ onSelect }: { onSelect: (emoji: string) => void }) => (
    <button onClick={() => onSelect('🎲')}>scegli 🎲</button>
  ),
}));

const card = () => screen.getByRole('article');

describe('PostItCard', () => {
  it("shows the viewer's own signed post-it, which they edit", async () => {
    const { act, user } = renderBoard(<PostItCard postIt={postIt()} onLinesVeils={false} />);
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
    const { act, user } = renderBoard(<PostItCard postIt={postIt()} onLinesVeils={false} />);
    await user.click(screen.getByRole('button', { name: 'Azioni del post-it' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Modifica' }));
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(act).not.toHaveBeenCalled();
    expect(card()).toHaveTextContent('Niente ragni');
  });

  it('deletes the post-it', async () => {
    const { act, user } = renderBoard(<PostItCard postIt={postIt()} onLinesVeils={false} />);
    await user.click(screen.getByRole('button', { name: 'Azioni del post-it' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Elimina' }));
    expect(act).toHaveBeenCalledWith(boardWrites.deletePostIt('card-1'));
  });

  // Decisions 1 and 7: a draft is published signed or anonymous.
  it('publishes a draft anonymously after asking', async () => {
    const { act, user } = renderBoard(
      <PostItCard postIt={postIt({ draft: true, can_publish: true, can_react: false })} onLinesVeils={false} />,
    );
    expect(screen.getByText('Bozza')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Azioni del post-it' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Pubblica' }));
    await user.click(await screen.findByRole('button', { name: 'Annulla' }));
    expect(act).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Azioni del post-it' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Pubblica' }));
    await user.click(await screen.findByRole('switch', { name: /Pubblica in anonimo/ }));
    await user.click(screen.getByRole('button', { name: 'Pubblica' }));
    expect(act).toHaveBeenCalledWith(boardWrites.publish('card-1', true));
  });

  it("names someone else's author, hides an anonymous one, and marks the viewer's own anonymous post-it", () => {
    renderBoard(
      <>
        <PostItCard postIt={postIt({ id: 'a', author_id: 'user-2', mine: false })} onLinesVeils={false} />
        <PostItCard postIt={postIt({ id: 'b', author_id: null, mine: false, anonymous: true })} onLinesVeils={false} />
        <PostItCard postIt={postIt({ id: 'c', anonymous: true, from_retro: true })} onLinesVeils />
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
      <PostItCard postIt={postIt({ can_edit: false, can_delete: false, can_promote: true })} onLinesVeils={false} />,
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
    expect(dataTransfer.effectAllowed).toBe('copy');
  });

  // Decision 16: a Lines & Veils post-it moves to the other two columns.
  it('moves a Lines & Veils post-it to another column', async () => {
    const { act, user } = renderBoard(
      <PostItCard postIt={postIt({ column_id: 'lv-must', can_move: true })} onLinesVeils />,
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
    const { act, user } = renderBoard(<PostItCard postIt={postIt({ reactions })} onLinesVeils={false} />);
    await user.click(screen.getByRole('button', { name: /^👍/ }));
    expect(act).toHaveBeenCalledWith(boardWrites.react('card-1', '👍', false));
    await user.click(screen.getByRole('button', { name: 'Aggiungi una reazione' }));
    await user.click(await screen.findByRole('button', { name: 'scegli 🎲' }));
    expect(act).toHaveBeenCalledWith(boardWrites.react('card-1', '🎲', true));
  });

  // Spec 22b: in "View as" nothing writes, so no menu, no picker, no drag.
  it('only shows the post-it while the Master previews the Room', () => {
    const reactions = [{ emoji: '👍', count: 1, reacted_by_me: false, user_ids: ['user-2'] }];
    renderBoard(<PostItCard postIt={postIt({ reactions, can_promote: true })} onLinesVeils={false} />, {
      writable: false,
    });
    expect(screen.queryByRole('button', { name: 'Azioni del post-it' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aggiungi una reazione' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^👍/ })).toBeDisabled();
    expect(card()).not.toHaveAttribute('draggable', 'true');
  });

  it('shows no reactions row on a post-it that takes none and has none', () => {
    renderBoard(
      <PostItCard postIt={postIt({ can_react: false, can_edit: false, can_delete: false })} onLinesVeils={false} />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
