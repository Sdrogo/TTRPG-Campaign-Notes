import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { notifyError } from '../../lib/notify';
import { rawComment } from '../../test/fixtures';
import i18n from '../../i18n';
import { renderWithProviders } from '../../test/utils';
import { CommentSection } from './CommentSection';
import type { Member } from '../../types/member';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

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

// Answers the Comment list route with `list`, and anything else (a write,
// an image attach) with `onWrite`. A test that only reads can omit it.
function mockRoutes(
  list: unknown[],
  onWrite: (path: string) => Promise<unknown> = () => Promise.resolve(),
) {
  fetchMock.mockImplementation((path: string, init?: { method?: string }) =>
    path === '/rooms/room-1/documents/doc-1/comments' && !init?.method
      ? Promise.resolve(list)
      : onWrite(path),
  );
}

const members = [
  member(),
  member({ userId: 'user-2', displayName: 'Master', email: 'master@example.com' }),
];

function render() {
  renderWithProviders(
    <CommentSection
      roomId="room-1"
      documentId="doc-1"
      members={members}
      currentUserId="user-1"
    />,
  );
  return { user: userEvent.setup() };
}

const composer = () => screen.getByRole('textbox', { name: 'Testo del commento' });

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(notifyError).mockClear();
});

describe('CommentSection', () => {
  it('invites the first Comment when there are none', async () => {
    mockRoutes([]);
    render();

    expect(await screen.findByText(/Nessun commento ancora/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Cerca nei commenti')).not.toBeInTheDocument();
  });

  it('lists the Comments with a count', async () => {
    mockRoutes([rawComment(), rawComment({ id: 'comment-2', body: 'Secondo', author_id: 'user-2' })]);
    render();

    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(2));
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  // Not through `mockRoutes`: its list route always resolves, and this test
  // needs the load itself to fail.
  it('reports a failed load', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render();

    expect(await screen.findByText('Impossibile caricare i commenti.')).toBeInTheDocument();
  });

  it('posts a new Comment', async () => {
    mockRoutes([]);
    const { user } = render();
    await screen.findByText(/Nessun commento ancora/);

    mockRoutes([rawComment()], () => Promise.resolve(rawComment()));
    await user.type(composer(), 'Ricordate il sigillo.');
    await user.click(screen.getByRole('button', { name: /Pubblica/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents/doc-1/comments', {
        method: 'POST',
        json: { body: 'Ricordate il sigillo.', visibility: 'room', selective_user_ids: [] },
      }),
    );
  });

  it('clears the composer once the Comment is saved', async () => {
    mockRoutes([]);

    const { user } = render();
    await screen.findByText(/Nessun commento ancora/);

    mockRoutes([rawComment()], () => Promise.resolve(rawComment()));
    await user.type(composer(), 'Ricordate il sigillo.');
    await user.click(screen.getByRole('button', { name: /Pubblica/ }));

    await waitFor(() => expect(composer()).toHaveValue(''));
  });

  it('reports a failed post', async () => {
    mockRoutes([]);
    const { user } = render();
    await screen.findByText(/Nessun commento ancora/);

    fetchMock.mockRejectedValue(new Error('Body cannot be blank'));
    await user.type(composer(), 'x');
    await user.click(screen.getByRole('button', { name: /Pubblica/ }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });

  // The Comment itself saved; only some images didn't. Losing the text
  // would be worse than reporting the partial failure.
  it('warns when the Comment saved but an image did not', async () => {
    mockRoutes([]);
    const { user } = render();
    await screen.findByText(/Nessun commento ancora/);

    mockRoutes([rawComment()], (path) =>
      path.includes('/images')
        ? Promise.reject(new Error('Too many images'))
        : Promise.resolve(rawComment()),
    );
    await user.click(screen.getByRole('button', { name: 'Aggiungi immagine da URL' }));
    await user.type(screen.getByLabelText("URL dell'immagine"), 'https://example.com/map.png');
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));
    await user.type(composer(), 'Con immagine');
    await user.click(screen.getByRole('button', { name: /Pubblica/ }));

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Commento salvato, ma non tutte le immagini'),
        }),
      ),
    );
  });
});

describe('filtering', () => {
  async function renderWithComments() {
    mockRoutes([
      rawComment({ id: 'comment-1', body: 'Il sigillo', author_id: 'user-1' }),
      rawComment({ id: 'comment-2', body: 'La porta', author_id: 'user-2' }),
    ]);

    const handle = render();
    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(2));
    return handle;
  }

  it('narrows the list by search and says how many are shown', async () => {
    const { user } = await renderWithComments();

    await user.type(screen.getByLabelText('Cerca nei commenti'), 'sigillo');

    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1));
    expect(screen.getByText('1 di 2 commenti')).toBeInTheDocument();
  });

  it('offers a way out when nothing matches', async () => {
    const { user } = await renderWithComments();

    await user.type(screen.getByLabelText('Cerca nei commenti'), 'niente');

    expect(await screen.findByText('Nessun commento corrisponde ai filtri.')).toBeInTheDocument();
    // Both the toolbar and the empty state offer a reset; the empty state's
    // is the one rendered second.
    await user.click(screen.getAllByRole('button', { name: /Azzera filtri/ }).at(-1)!);

    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(2));
  });

  it('updates an unknown author label when the language changes', async () => {
    mockRoutes([rawComment({ author_id: 'former-member' })]);
    const { user } = render();
    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1));

    await user.click(screen.getByRole('combobox', { name: 'Filtra per autore' }));
    expect(screen.getByRole('option', { name: 'Utente sconosciuto' })).toBeInTheDocument();

    await i18n.changeLanguage('en');
    await user.click(screen.getByRole('combobox', { name: 'Filter by author' }));
    expect(await screen.findByRole('option', { name: 'Unknown user' })).toBeInTheDocument();
  });

  it('filters by author', async () => {
    const { user } = await renderWithComments();

    await user.click(screen.getByRole('combobox', { name: 'Filtra per autore' }));
    await user.click(screen.getByRole('option', { name: 'Master' }));

    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1));
    expect(screen.getByText('La porta')).toBeInTheDocument();
  });
});

describe('editing from the list', () => {
  it('saves an edit made in place', async () => {
    const writes: string[] = [];
    mockRoutes([rawComment()], (path) => {
      writes.push(path);
      return Promise.resolve(rawComment({ body: 'Nuovo testo' }));
    });
    const { user } = render();
    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1));

    await user.click(screen.getByText('Modifica'));
    const editor = screen.getAllByRole('textbox', { name: 'Testo del commento' })[0];
    await user.clear(editor);
    await user.type(editor, 'Nuovo testo');
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() =>
      expect(writes).toContain('/rooms/room-1/documents/doc-1/comments/comment-1'),
    );
  });

  // The edit form closes only once the save succeeds, so a failure leaves
  // the text on screen to retry.
  it('closes the editor after a successful save', async () => {
    mockRoutes([rawComment()], () => Promise.resolve(rawComment()));
    const { user } = render();
    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1));
    await user.click(screen.getByText('Modifica'));

    await user.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(screen.getByText('Modifica')).toBeInTheDocument());
  });

  it('reports a rejected edit', async () => {
    mockRoutes([rawComment()], () => Promise.reject(new Error('Only the author can edit')));
    const { user } = render();
    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1));
    await user.click(screen.getByText('Modifica'));

    await user.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });
});

describe('deleting from the list', () => {
  it('deletes the Comment the action belongs to', async () => {
    mockRoutes([rawComment()], () => Promise.resolve(rawComment()));
    const { user } = render();
    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1));

    await user.click(screen.getByText('Elimina'));
    await user.click(screen.getAllByRole('button', { name: 'Elimina' }).at(-1)!);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/rooms/room-1/documents/doc-1/comments/comment-1',
        { method: 'DELETE' },
      ),
    );
  });

  it('reports a failed delete', async () => {
    mockRoutes([rawComment()], () => Promise.resolve(rawComment()));
    const { user } = render();
    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1));

    fetchMock.mockRejectedValue(new Error('Only the author or the Master'));
    await user.click(screen.getByText('Elimina'));
    await user.click(screen.getAllByRole('button', { name: 'Elimina' }).at(-1)!);

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });
});
