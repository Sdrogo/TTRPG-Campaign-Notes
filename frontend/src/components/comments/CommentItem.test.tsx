import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { CommentItem } from './CommentItem';
import type { Comment } from '../../types/comment';
import type { Member } from '../../types/member';

function member(overrides: Partial<Member> = {}): Member {
  return {
    userId: 'user-1',
    role: 'player',
    isAdmin: false,
    email: 'giocatore@example.com',
    displayName: 'Giocatore',
    pronouns: null,
    bio: null,
    avatarUrl: null,
    ...overrides,
  };
}

const members = [member(), member({ userId: 'user-2', displayName: 'Master' })];

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'comment-1',
    documentId: 'doc-1',
    authorId: 'user-1',
    body: 'Ricordate il sigillo.',
    visibility: 'room',
    selectiveUserIds: [],
    createdAt: '2026-09-21T12:00:00Z',
    updatedAt: '2026-09-21T12:00:00Z',
    deleted: false,
    images: [],
    canEdit: true,
    canDelete: true,
    ...overrides,
  };
}

function render(overrides: Partial<Comment> = {}, currentUserId = 'user-1') {
  const onUpdate = vi.fn();
  const onDelete = vi.fn();
  renderWithProviders(
    <CommentItem
      comment={comment(overrides)}
      members={members}
      currentUserId={currentUserId}
      onUpdate={onUpdate}
      updating={false}
      onDelete={onDelete}
      deleting={false}
    />,
  );
  return { onUpdate, onDelete, user: userEvent.setup() };
}

describe('CommentItem', () => {
  it('shows the author and the body', () => {
    render();

    expect(screen.getByText('Giocatore')).toBeInTheDocument();
    expect(screen.getByText('Ricordate il sigillo.')).toBeInTheDocument();
  });

  it('marks your own Comment', () => {
    render();

    expect(screen.getByText('(tu)')).toBeInTheDocument();
  });

  it('does not mark someone else\'s', () => {
    render({}, 'user-2');

    expect(screen.queryByText('(tu)')).not.toBeInTheDocument();
  });

  // Room is the default and the common case; badging every Comment with it
  // would be noise. Anything narrower is worth flagging.
  it('badges only a narrowed visibility', () => {
    render({ visibility: 'private' });

    expect(screen.getByText('Privato')).toBeInTheDocument();
  });

  it('shows no badge at Room visibility', () => {
    render();

    expect(screen.queryByText('Stanza')).not.toBeInTheDocument();
  });

  // FR-T5: a deleted Comment keeps its place in the conversation.
  it('leaves a placeholder for a deleted Comment', () => {
    render({ deleted: true, body: '' });

    expect(screen.getByText('Commento eliminato.')).toBeInTheDocument();
  });

  it('timestamps the Comment', () => {
    render();

    expect(screen.getByRole('time')).toHaveAttribute('datetime', '2026-09-21T12:00:00Z');
  });

  it('marks an edited Comment', () => {
    render({ updatedAt: '2026-09-21T13:00:00Z' });

    expect(screen.getByText('Modificato')).toBeInTheDocument();
  });

  it('does not mark an unedited one', () => {
    render();

    expect(screen.queryByText('Modificato')).not.toBeInTheDocument();
  });
});

describe('permissions', () => {
  // The backend decides these per viewer and the UI must not re-derive them.
  it('offers no actions when the viewer may do neither', () => {
    render({ canEdit: false, canDelete: false });

    expect(screen.queryByText('Modifica')).not.toBeInTheDocument();
    expect(screen.queryByText('Elimina')).not.toBeInTheDocument();
  });

  // The Master can delete for moderation but may not edit someone's words.
  it('can offer delete without edit', () => {
    render({ canEdit: false, canDelete: true });

    expect(screen.queryByText('Modifica')).not.toBeInTheDocument();
    expect(screen.getByText('Elimina')).toBeInTheDocument();
  });
});

describe('editing', () => {
  it('opens the composer with the current text', async () => {
    const { user } = render();

    await user.click(screen.getByText('Modifica'));

    expect(screen.getByRole('textbox', { name: 'Testo del commento' })).toHaveValue(
      'Ricordate il sigillo.',
    );
  });

  it('hides the meta line while editing', async () => {
    const { user } = render();

    await user.click(screen.getByText('Modifica'));

    expect(screen.queryByRole('time')).not.toBeInTheDocument();
  });

  it('returns to the Comment on cancel', async () => {
    const { user } = render();
    await user.click(screen.getByText('Modifica'));

    await user.click(screen.getByRole('button', { name: 'Annulla' }));

    expect(screen.getByText('Ricordate il sigillo.')).toBeInTheDocument();
  });

  it('reports the edited values', async () => {
    const { onUpdate, user } = render();
    await user.click(screen.getByText('Modifica'));

    await user.clear(screen.getByRole('textbox', { name: 'Testo del commento' }));
    await user.type(screen.getByRole('textbox', { name: 'Testo del commento' }), 'Nuovo testo');
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Nuovo testo' }),
      expect.any(Function),
    );
  });
});

describe('deleting', () => {
  it('asks before deleting', async () => {
    const { onDelete, user } = render();

    await user.click(screen.getByText('Elimina'));

    expect(screen.getByText('Eliminare questo commento?')).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  // Deleting a Comment also removes its images from the Document's gallery,
  // which isn't obvious from "delete comment".
  it('warns that attached images go too', async () => {
    const { user } = render({ images: [{ id: 'image-1', url: 'http://a/1.webp', isFavorite: false }] });

    await user.click(screen.getByText('Elimina'));

    expect(screen.getByText(/Anche le sue immagini verranno rimosse/)).toBeInTheDocument();
  });

  it('omits that warning when there are no images', async () => {
    const { user } = render();

    await user.click(screen.getByText('Elimina'));

    expect(screen.queryByText(/Anche le sue immagini verranno rimosse/)).not.toBeInTheDocument();
  });

  it('deletes once confirmed', async () => {
    const { onDelete, user } = render();
    await user.click(screen.getByText('Elimina'));

    // Both the trigger and the confirmation read "Elimina"; the confirmation
    // is the one rendered inside the popover, so it comes last.
    await user.click(screen.getAllByRole('button', { name: 'Elimina' }).at(-1)!);

    expect(onDelete).toHaveBeenCalled();
  });

  it('deletes nothing when dismissed', async () => {
    const { onDelete, user } = render();
    await user.click(screen.getByText('Elimina'));

    await user.click(screen.getByRole('button', { name: 'Annulla' }));

    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe('attached images', () => {
  const images = [
    { id: 'image-1', url: 'http://a/1.webp', isFavorite: false },
    { id: 'image-2', url: 'http://a/2.webp', isFavorite: false },
  ];

  it('shows a thumbnail per image, labelled by author', () => {
    render({ images });

    expect(
      screen.getByAltText('Immagine 1 del commento di Giocatore'),
    ).toBeInTheDocument();
    expect(screen.getByAltText('Immagine 2 del commento di Giocatore')).toBeInTheDocument();
  });

  it('opens the viewer on the clicked thumbnail', async () => {
    const { user } = render({ images });

    await user.click(
      screen.getByRole('button', { name: 'Apri Immagine 2 del commento di Giocatore' }),
    );

    expect(screen.getByAltText('Commento di Giocatore')).toHaveAttribute(
      'src',
      'http://a/2.webp',
    );
  });

  it('shows no image area when there are none', () => {
    render();

    expect(screen.queryByTestId('image-thumbnails')).not.toBeInTheDocument();
  });
});
