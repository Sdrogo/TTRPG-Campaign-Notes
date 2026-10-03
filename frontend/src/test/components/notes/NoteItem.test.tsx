import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DocumentMentionsContext } from '../../../hooks/useDocumentMentions';
import { renderWithProviders } from '../../utils';
import { NoteItem } from '../../../components/notes/NoteItem';
import type { DocumentMentionsValue } from '../../../hooks/useDocumentMentions';
import type { Document } from '../../../types/document';
import type { Member } from '../../../types/member';
import type { Note } from '../../../types/note';

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    documentId: 'doc-1',
    title: 'Porta segreta',
    description: 'Dietro la libreria.',
    visibility: 'room',
    selectiveUserIds: [],
    position: 0,
    createdAt: '2026-10-01T12:00:00Z',
    updatedAt: '2026-10-01T12:00:00Z',
    canEdit: true,
    canDelete: true,
    ...overrides,
  };
}

const members: Member[] = [
  {
    userId: 'user-1',
    role: 'player',
    isAdmin: false,
    email: 'giocatore@example.com',
    displayName: 'Giocatore',
    pronouns: null,
    bio: null,
    avatarUrl: null,
  },
];

function document(id: string, name: string): Document {
  return {
    id,
    roomId: 'room-1',
    name,
    description: '',
    visibility: 'room',
    images: [],
    tagIds: [],
    ownerIds: [],
    selectiveUserIds: [],
    notes: [],
    files: [],
    playedBy: null,
  };
}

interface Options {
  note?: Partial<Note>;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  moving?: boolean;
  updating?: boolean;
  deleting?: boolean;
  documents?: Document[];
  revealed?: boolean;
  onReveal?: () => void;
}

function render(options: Options = {}) {
  const onMove = vi.fn();
  const onUpdate = vi.fn();
  const onDelete = vi.fn();
  const mentions: DocumentMentionsValue = {
    roomId: 'room-1',
    documents: options.documents ?? [document('doc-2', 'Il Cancello')],
    tags: [],
    canCreateDocument: false,
    canCreateTag: false,
    create: async () => {
      throw new Error('not used');
    },
  };
  renderWithProviders(
    <DocumentMentionsContext value={mentions}>
      <NoteItem
        note={note(options.note)}
        members={members}
        canMoveUp={options.canMoveUp ?? true}
        canMoveDown={options.canMoveDown ?? true}
        onMove={onMove}
        moving={options.moving ?? false}
        onUpdate={onUpdate}
        updating={options.updating ?? false}
        onDelete={onDelete}
        deleting={options.deleting ?? false}
        revealed={options.revealed}
        onReveal={options.onReveal}
      />
    </DocumentMentionsContext>,
  );
  return { onMove, onUpdate, onDelete, user: userEvent.setup() };
}

const editButton = () => screen.queryByRole('button', { name: 'Modifica Nota: Porta segreta' });
const deleteButton = () => screen.queryByRole('button', { name: 'Elimina Nota: Porta segreta' });
const upButton = () => screen.queryByRole('button', { name: 'Sposta su la Nota: Porta segreta' });
const downButton = () =>
  screen.queryByRole('button', { name: 'Sposta giù la Nota: Porta segreta' });

describe('reading a Note', () => {
  it('shows the title as a heading and the description below it', () => {
    render();

    expect(screen.getByRole('heading', { name: 'Porta segreta', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Dietro la libreria.')).toBeInTheDocument();
  });

  it('shows no description paragraph for a Note without one', () => {
    render({ note: { description: '' } });

    expect(screen.getByTestId('note-item')).toHaveTextContent(/^Porta segreta/);
    expect(screen.getByTestId('note-item').querySelector('p')).toBeNull();
  });

  // Same `#` logic as a Document description (spec 12).
  it('links a mention of a Document the viewer can see', () => {
    render({ note: { description: 'Vedi #Il Cancello per il resto.' } });

    expect(screen.getByTestId('document-mention').closest('a')).toHaveAttribute(
      'href',
      '/rooms/room-1/documents/doc-2',
    );
  });

  // VR-07: a Document missing from the viewer's list is a Document they can't
  // see, and its mention must not reveal that it exists.
  it('leaves a mention of a Document the viewer cannot see as plain text', () => {
    render({ note: { description: 'Vedi #Il Cancello per il resto.' }, documents: [] });

    expect(screen.queryByTestId('document-mention')).not.toBeInTheDocument();
    expect(screen.getByText('Vedi #Il Cancello per il resto.')).toBeInTheDocument();
  });
});

describe('what the viewer may do', () => {
  it('offers everything to someone who can edit and delete', () => {
    render();

    expect(editButton()).toBeInTheDocument();
    expect(deleteButton()).toBeInTheDocument();
    expect(upButton()).toBeInTheDocument();
    expect(downButton()).toBeInTheDocument();
    expect(screen.getByText('Stanza')).toBeInTheDocument();
  });

  // A plain reader gets no controls and no visibility badge.
  it('offers nothing to a reader', () => {
    render({ note: { canEdit: false, canDelete: false } });

    expect(editButton()).not.toBeInTheDocument();
    expect(deleteButton()).not.toBeInTheDocument();
    expect(upButton()).not.toBeInTheDocument();
    expect(screen.queryByText('Stanza')).not.toBeInTheDocument();
  });

  it('offers only deletion when the backend allows only that', () => {
    render({ note: { canEdit: false, canDelete: true } });

    expect(deleteButton()).toBeInTheDocument();
    expect(editButton()).not.toBeInTheDocument();
    expect(upButton()).not.toBeInTheDocument();
  });

  it('offers no deletion when the backend does not allow it', () => {
    render({ note: { canEdit: true, canDelete: false } });

    expect(editButton()).toBeInTheDocument();
    expect(deleteButton()).not.toBeInTheDocument();
  });

  it('shows who can read a restricted Note to those who manage it', () => {
    render({ note: { visibility: 'master' } });

    expect(screen.getByText('Solo Master')).toBeInTheDocument();
  });
});

describe('reordering', () => {
  it('moves the Note up and down', async () => {
    const { onMove, user } = render();

    await user.click(upButton()!);
    await user.click(downButton()!);

    expect(onMove.mock.calls).toEqual([[-1], [1]]);
  });

  it('cannot move the first Note up or the last one down', () => {
    render({ canMoveUp: false, canMoveDown: false });

    expect(upButton()).toBeDisabled();
    expect(downButton()).toBeDisabled();
  });

  it('cannot be moved again while a move is being saved', () => {
    render({ moving: true });

    expect(upButton()).toBeDisabled();
    expect(downButton()).toBeDisabled();
  });
});

describe('editing', () => {
  it('opens the form on the saved values and saves them', async () => {
    const { onUpdate, user } = render({
      note: { visibility: 'selective', selectiveUserIds: ['user-1'] },
    });

    await user.click(editButton()!);
    const title = screen.getByRole('textbox', { name: /Titolo/ });
    expect(title).toHaveValue('Porta segreta');
    await user.clear(title);
    await user.type(title, 'Passaggio');
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    expect(onUpdate).toHaveBeenCalledWith(
      {
        title: 'Passaggio',
        description: 'Dietro la libreria.',
        visibility: 'selective',
        selectiveUserIds: ['user-1'],
      },
      expect.any(Function),
    );
  });

  it('closes the form once the save is done', async () => {
    const { onUpdate, user } = render();
    await user.click(editButton()!);
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    const onDone = onUpdate.mock.calls[0][1] as () => void;
    act(() => onDone());

    expect(screen.queryByRole('textbox', { name: /Titolo/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Porta segreta' })).toBeInTheDocument();
  });

  it('keeps the form open until the save is done', async () => {
    const { user } = render();
    await user.click(editButton()!);
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    expect(screen.getByRole('textbox', { name: /Titolo/ })).toBeInTheDocument();
  });

  it('discards the changes on cancel', async () => {
    const { onUpdate, user } = render();
    await user.click(editButton()!);
    await user.type(screen.getByRole('textbox', { name: /Titolo/ }), ' bis');
    await user.click(screen.getByRole('button', { name: 'Annulla' }));

    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Porta segreta' })).toBeInTheDocument();
  });

  it('shows the save in progress', async () => {
    const { user } = render({ updating: true });
    await user.click(editButton()!);

    expect(screen.getByRole('button', { name: 'Salva' })).toHaveAttribute('data-loading', 'true');
  });
});

describe('deleting', () => {
  it('asks first, then deletes', async () => {
    const { onDelete, user } = render();

    await user.click(deleteButton()!);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Eliminare questa Nota?')).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(dialog.getByRole('button', { name: 'Elimina' }));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the confirmation is cancelled', async () => {
    const { onDelete, user } = render();

    await user.click(deleteButton()!);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Annulla' }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText('Eliminare questa Nota?')).not.toBeInTheDocument();
  });

  it('dismisses the confirmation on Escape too, not just Cancel', async () => {
    const { onDelete, user } = render();

    await user.click(deleteButton()!);
    expect(screen.getByText('Eliminare questa Nota?')).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByText('Eliminare questa Nota?')).not.toBeInTheDocument(),
    );
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('shows the deletion in progress', async () => {
    const { user } = render({ deleting: true });
    await user.click(deleteButton()!);

    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Elimina' }),
    ).toHaveAttribute('data-loading', 'true');
  });
});

// Spec 22: the Master reveals a Note; a Note revealed to the viewer is marked.
describe('revealing a Note', () => {
  it('offers the Master the Reveal action, even without edit rights', async () => {
    const onReveal = vi.fn();
    const { user } = render({ note: { canEdit: false, canDelete: false }, onReveal });

    await user.click(screen.getByRole('button', { name: 'Rivela: Porta segreta' }));

    expect(onReveal).toHaveBeenCalled();
    expect(editButton()).not.toBeInTheDocument();
  });

  it('marks a Note this visit opened as revealed', () => {
    render({ revealed: true });

    expect(screen.getByText('Rivelato')).toBeInTheDocument();
  });
});
