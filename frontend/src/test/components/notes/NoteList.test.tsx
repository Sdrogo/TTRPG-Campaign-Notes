import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/apiClient';
import { notifyError } from '../../../lib/notify';
import { rawNote } from '../../fixtures';
import { renderWithProviders } from '../../utils';
import { NoteList } from '../../../components/notes/NoteList';
import { toNote, type RawNote } from '../../../lib/notes';
import type { Member } from '../../../types/member';
import type { Note } from '../../../types/note';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);
const BASE = '/rooms/room-1/documents/doc-1/notes';

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

function note(overrides: Record<string, unknown> = {}): Note {
  return toNote(rawNote(overrides) as RawNote);
}

const first = () => note();
const second = () =>
  note({ id: 'note-2', title: 'Trappola', description: 'Un dardo.', position: 1 });

function render(notes: Note[], canAdd = true) {
  renderWithProviders(
    <div data-testid="host">
      <NoteList
        roomId="room-1"
        documentId="doc-1"
        notes={notes}
        members={members}
        canAdd={canAdd}
      />
    </div>,
  );
  return { host: screen.getByTestId('host'), user: userEvent.setup() };
}

const titles = () => screen.queryAllByRole('heading', { level: 4 }).map((h) => h.textContent);

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(notifyError).mockClear();
  fetchMock.mockResolvedValue(rawNote());
});

describe('what is shown', () => {
  // The page must look as it did before Notes existed.
  it('renders nothing with no Notes and no right to add one', () => {
    const { host } = render([], false);

    expect(host).toBeEmptyDOMElement();
  });

  it('offers only the add action to an Owner of a Document without Notes', () => {
    render([], true);

    expect(screen.getByRole('button', { name: 'Aggiungi Nota' })).toBeInTheDocument();
    expect(titles()).toEqual([]);
  });

  it('lists the Notes exactly as given, in order', () => {
    render([first(), second()]);

    expect(titles()).toEqual(['Porta segreta', 'Trappola']);
    expect(screen.getByText('Un dardo.')).toBeInTheDocument();
  });

  // The backend leaves hidden Notes out. Nothing here may hint that some were.
  it('shows no trace of Notes it was not given', () => {
    const { host } = render([first()], false);

    expect(titles()).toEqual(['Porta segreta']);
    expect(host).not.toHaveTextContent(/nascost|hidden|\d+ Not/i);
  });

  it('gives a plain reader the text and no controls', () => {
    render([note({ can_edit: false, can_delete: false })], false);

    expect(screen.getByText('Dietro la libreria.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('adding a Note', () => {
  it('opens a form, saves it, and closes it', async () => {
    const { user } = render([first()]);

    await user.click(screen.getByRole('button', { name: 'Aggiungi Nota' }));
    await user.type(screen.getByRole('textbox', { name: /Titolo/ }), 'Trappola');
    await user.type(screen.getByRole('textbox', { name: 'Descrizione' }), 'Un dardo.');
    await user.click(screen.getAllByRole('button', { name: 'Aggiungi Nota' })[0]);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(BASE, {
        method: 'POST',
        json: {
          title: 'Trappola',
          description: 'Un dardo.',
          visibility: 'room',
          selective_user_ids: [],
        },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: /Titolo/ })).not.toBeInTheDocument(),
    );
  });

  it('cancels without saving', async () => {
    const { user } = render([]);

    await user.click(screen.getByRole('button', { name: 'Aggiungi Nota' }));
    await user.click(screen.getByRole('button', { name: 'Annulla' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Aggiungi Nota' })).toBeInTheDocument();
  });

  it('reports a failure and keeps what was typed', async () => {
    fetchMock.mockRejectedValue(new Error('Troppe Note'));
    const { user } = render([]);

    await user.click(screen.getByRole('button', { name: 'Aggiungi Nota' }));
    await user.type(screen.getByRole('textbox', { name: /Titolo/ }), 'Trappola');
    await user.click(screen.getAllByRole('button', { name: 'Aggiungi Nota' })[0]);

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(screen.getByRole('textbox', { name: /Titolo/ })).toHaveValue('Trappola');
  });
});

describe('editing a Note', () => {
  it('saves the change', async () => {
    const { user } = render([first(), second()]);

    await user.click(screen.getByRole('button', { name: 'Modifica Nota: Trappola' }));
    const title = screen.getByRole('textbox', { name: /Titolo/ });
    await user.clear(title);
    await user.type(title, 'Dardo');
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`${BASE}/note-2`, {
        method: 'PATCH',
        json: expect.objectContaining({ title: 'Dardo' }),
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: /Titolo/ })).not.toBeInTheDocument(),
    );
  });

  it('reports a failure and stays open', async () => {
    fetchMock.mockRejectedValue(new Error('Non trovata'));
    const { user } = render([first()]);

    await user.click(screen.getByRole('button', { name: 'Modifica Nota: Porta segreta' }));
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(screen.getByRole('textbox', { name: /Titolo/ })).toBeInTheDocument();
  });

  // Only the Note being saved shows progress, not its neighbours.
  it('shows progress on the Note being saved only', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { user } = render([first(), second()]);

    await user.click(screen.getByRole('button', { name: 'Modifica Nota: Porta segreta' }));
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    await user.click(screen.getByRole('button', { name: 'Modifica Nota: Trappola' }));

    const [saving, idle] = screen.getAllByRole('button', { name: 'Salva' });
    expect(saving).toHaveAttribute('data-loading', 'true');
    expect(idle).not.toHaveAttribute('data-loading');
  });
});

describe('deleting a Note', () => {
  it('deletes it after the confirmation', async () => {
    const { user } = render([first(), second()]);

    await user.click(screen.getByRole('button', { name: 'Elimina Nota: Trappola' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Elimina' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`${BASE}/note-2`, { method: 'DELETE' }),
    );
  });

  it('reports a failure', async () => {
    fetchMock.mockRejectedValue(new Error('Non trovata'));
    const { user } = render([first()]);

    await user.click(screen.getByRole('button', { name: 'Elimina Nota: Porta segreta' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Elimina' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });

  // Only the Note being deleted is marked busy, not its neighbours.
  it('marks only the deleted Note as busy', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { user } = render([first(), second()]);

    await user.click(screen.getByRole('button', { name: 'Elimina Nota: Porta segreta' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Elimina' }));
    await user.click(screen.getByRole('button', { name: 'Elimina Nota: Trappola' }));

    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Elimina' }),
    ).not.toHaveAttribute('data-loading');
  });
});

describe('reordering', () => {
  it('sends the new order of the Notes it shows', async () => {
    const { user } = render([first(), second()]);

    await user.click(screen.getByRole('button', { name: 'Sposta giù la Nota: Porta segreta' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`${BASE}/order`, {
        method: 'PUT',
        json: { note_ids: ['note-2', 'note-1'] },
      }),
    );
  });

  it('moves a Note up', async () => {
    const { user } = render([first(), second()]);

    await user.click(screen.getByRole('button', { name: 'Sposta su la Nota: Trappola' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`${BASE}/order`, {
        method: 'PUT',
        json: { note_ids: ['note-2', 'note-1'] },
      }),
    );
  });

  it('cannot move the ends outward, so a lone Note has no move to make', () => {
    render([first(), second()]);

    expect(screen.getByRole('button', { name: 'Sposta su la Nota: Porta segreta' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sposta giù la Nota: Trappola' })).toBeDisabled();
  });

  it('reports a failure', async () => {
    fetchMock.mockRejectedValue(new Error('Ordine non valido'));
    const { user } = render([first(), second()]);

    await user.click(screen.getByRole('button', { name: 'Sposta giù la Nota: Porta segreta' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });

  it('blocks a second move while one is being saved', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { user } = render([first(), second()]);

    await user.click(screen.getByRole('button', { name: 'Sposta giù la Nota: Porta segreta' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sposta su la Nota: Trappola' })).toBeDisabled(),
    );
  });
});
