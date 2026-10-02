import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../utils';
import { apiFetch } from '../../../lib/apiClient';
import { notifyError } from '../../../lib/notify';
import { rawComment } from '../../fixtures';
import { CommentItem } from '../../../components/comments/CommentItem';
import type { Character } from '../../../types/character';
import type { Comment } from '../../../types/comment';
import type { Member } from '../../../types/member';

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

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../lib/notify', () => ({ notifyError: vi.fn() }));

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
    asCharacter: null,
    parentId: null,
    parentHidden: false,
    reactions: [],
    pinnedAt: null,
    resolvedAt: null,
    resolvedBy: null,
    canPin: false,
    canResolve: false,
    ...overrides,
  };
}

const aria: Character = { documentId: 'doc-2', name: 'Aria', imageUrl: 'http://signed/aria.webp' };
const bram: Character = { documentId: 'doc-3', name: 'Bram', imageUrl: null };

function render(
  overrides: Partial<Comment> = {},
  currentUserId = 'user-1',
  characters: Character[] = [],
) {
  const onUpdate = vi.fn();
  const onDelete = vi.fn();
  renderWithProviders(
    <CommentItem
      roomId="room-1"
      comment={comment(overrides)}
      members={members}
      characters={characters}
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

  it("does not mark someone else's", () => {
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
    const { user } = render({
      images: [{ id: 'image-1', url: 'http://a/1.webp', isFavorite: false }],
    });

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

    expect(screen.getByAltText('Immagine 1 del commento di Giocatore')).toBeInTheDocument();
    expect(screen.getByAltText('Immagine 2 del commento di Giocatore')).toBeInTheDocument();
  });

  it('opens the viewer on the clicked thumbnail', async () => {
    const { user } = render({ images });

    await user.click(
      screen.getByRole('button', { name: 'Apri Immagine 2 del commento di Giocatore' }),
    );

    expect(screen.getByAltText('Commento di Giocatore')).toHaveAttribute('src', 'http://a/2.webp');
  });

  it('closes the viewer', async () => {
    const { user } = render({ images });
    await user.click(
      screen.getByRole('button', { name: 'Apri Immagine 2 del commento di Giocatore' }),
    );
    await screen.findByAltText('Commento di Giocatore');

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows no image area when there are none', () => {
    render();

    expect(screen.queryByTestId('image-thumbnails')).not.toBeInTheDocument();
  });
});

describe('in character', () => {
  // D-24/D-25: the Character leads, linked to its Document, and the real
  // author stays identifiable.
  it('shows the Character, linked to its Document, and who plays it', () => {
    render({ asCharacter: aria }, 'user-2');

    expect(screen.getByRole('link', { name: 'Aria' })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents/doc-2',
    );
    expect(screen.getByText('interpretato da Giocatore')).toBeInTheDocument();
    expect(screen.queryByText('(tu)')).not.toBeInTheDocument();
  });

  it('marks your own in-character Comment', () => {
    render({ asCharacter: aria });

    expect(screen.getByText('(tu)')).toBeInTheDocument();
  });

  it("uses the Character's picture instead of the author's", () => {
    render({ asCharacter: aria });

    expect(screen.getByRole('img', { name: 'Aria' })).toHaveAttribute(
      'src',
      'http://signed/aria.webp',
    );
  });

  it("names the Character in its images' labels", async () => {
    const { user } = render({
      asCharacter: aria,
      images: [{ id: 'image-1', url: 'http://a/1.webp', isFavorite: false }],
    });

    await user.click(screen.getByRole('button', { name: /Aria/ }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('offers no "Post as" while editing when there is nothing to write as', async () => {
    const { user } = render();

    await user.click(screen.getByText('Modifica'));

    expect(screen.queryByRole('combobox', { name: 'Scrivi come' })).not.toBeInTheDocument();
  });

  it("keeps the Comment's Character when the choice is left alone", async () => {
    // Bram isn't among the Characters the author may write as any more, but
    // stays pickable: an unchanged choice is omitted, so the backend keeps it.
    const { onUpdate, user } = render({ asCharacter: bram }, 'user-1', [aria]);
    await user.click(screen.getByText('Modifica'));

    expect(screen.getByRole('combobox', { name: 'Scrivi come' })).toHaveValue('Bram');
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    expect(onUpdate.mock.calls[0][0].asDocumentId).toBeUndefined();
  });

  it('sends a changed Character', async () => {
    const { onUpdate, user } = render({}, 'user-1', [aria]);
    await user.click(screen.getByText('Modifica'));

    await user.click(screen.getByRole('combobox', { name: 'Scrivi come' }));
    await user.click(screen.getByRole('option', { name: 'Aria' }));
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    expect(onUpdate.mock.calls[0][0].asDocumentId).toBe('doc-2');
  });

  it('starts the edit on the current Character when the author still plays it', async () => {
    const { user } = render({ asCharacter: aria }, 'user-1', [aria]);
    await user.click(screen.getByText('Modifica'));

    expect(screen.getByRole('combobox', { name: 'Scrivi come' })).toHaveValue('Aria');
  });

  it('turns an in-character Comment back into a plain one', async () => {
    const { onUpdate, user } = render({ asCharacter: aria }, 'user-1', [aria]);
    await user.click(screen.getByText('Modifica'));

    await user.click(screen.getByRole('combobox', { name: 'Scrivi come' }));
    await user.click(screen.getByRole('option', { name: 'Te stesso (Giocatore)' }));
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    expect(onUpdate.mock.calls[0][0].asDocumentId).toBeNull();
  });
});

describe('CommentItem reactions (spec 19c)', () => {
  const thumbs = { emoji: '👍', count: 1, reactedByMe: false, userIds: ['user-2'] };

  it('joins a reaction through the backend', async () => {
    vi.mocked(apiFetch).mockResolvedValue(rawComment());
    const { user } = render({ reactions: [thumbs] });

    await user.click(screen.getByRole('button', { name: '👍, 1 reazione: Master' }));

    expect(apiFetch).toHaveBeenCalledWith(
      `/rooms/room-1/documents/doc-1/comments/comment-1/reactions/${encodeURIComponent('👍')}`,
      { method: 'PUT' },
    );
  });

  it('reports a refused reaction', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('409'));
    const { user } = render({ reactions: [thumbs] });

    await user.click(screen.getByRole('button', { name: '👍, 1 reazione: Master' }));

    await vi.waitFor(() => expect(notifyError).toHaveBeenCalled());
  });

  // Decision 1: never on a deleted placeholder.
  it('offers no reactions on a deleted Comment', () => {
    render({ deleted: true, body: '', reactions: [thumbs] });

    expect(screen.queryByRole('button', { name: /reazion/ })).not.toBeInTheDocument();
  });
});

describe('CommentItem pin and resolve (spec 19c)', () => {
  function renderWithFlag(overrides: Partial<Comment> = {}, settingFlag = false) {
    const onSetFlag = vi.fn();
    renderWithProviders(
      <CommentItem
        roomId="room-1"
        comment={comment(overrides)}
        members={members}
        characters={[]}
        currentUserId="user-1"
        onUpdate={vi.fn()}
        updating={false}
        onDelete={vi.fn()}
        deleting={false}
        onSetFlag={onSetFlag}
        settingFlag={settingFlag}
      />,
    );
    return { onSetFlag, user: userEvent.setup() };
  }

  // The backend's flags decide: nothing is offered without them.
  it('offers neither action without canPin and canResolve', () => {
    renderWithFlag();

    expect(screen.queryByRole('button', { name: 'Fissa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Segna come risolto' })).not.toBeInTheDocument();
  });

  it('offers nothing without a handler, even when allowed', () => {
    render({ canPin: true, canResolve: true });

    expect(screen.queryByRole('button', { name: 'Fissa' })).not.toBeInTheDocument();
  });

  it('pins and resolves an open Comment', async () => {
    const { onSetFlag, user } = renderWithFlag({ canPin: true, canResolve: true });

    await user.click(screen.getByRole('button', { name: 'Fissa' }));
    await user.click(screen.getByRole('button', { name: 'Segna come risolto' }));

    expect(onSetFlag.mock.calls).toEqual([
      ['pin', true],
      ['resolve', true],
    ]);
  });

  it('unpins and reopens, and badges both states', async () => {
    const { onSetFlag, user } = renderWithFlag({
      canPin: true,
      canResolve: true,
      pinnedAt: '2026-10-02T12:00:00Z',
      resolvedAt: '2026-10-02T12:00:00Z',
      resolvedBy: 'user-2',
    });

    expect(screen.getByText('Fissato')).toBeInTheDocument();
    await user.hover(screen.getByText('Risolto'));
    expect(await screen.findByText(/Risolto da Master/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Togli dai fissati' }));
    await user.click(screen.getByRole('button', { name: 'Riapri' }));

    expect(onSetFlag.mock.calls).toEqual([
      ['pin', false],
      ['resolve', false],
    ]);
  });

  it('names an unknown resolver like any departed member', async () => {
    const { user } = renderWithFlag({ resolvedAt: '2026-10-02T12:00:00Z', resolvedBy: null });

    await user.hover(screen.getByText('Risolto'));
    expect(await screen.findByText(/Risolto da Utente sconosciuto/)).toBeInTheDocument();
  });

  it('disables both actions while a change is on its way', () => {
    renderWithFlag({ canPin: true, canResolve: true }, true);

    expect(screen.getByRole('button', { name: 'Fissa' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Segna come risolto' })).toBeDisabled();
  });
});
