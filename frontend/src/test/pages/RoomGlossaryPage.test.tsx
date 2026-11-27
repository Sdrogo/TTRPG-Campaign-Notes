import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../lib/apiClient';
import { useSession } from '../../hooks/useSession';
import { fakeSession, rawAccount, rawMember, rawRoom } from '../fixtures';
import { renderWithProviders } from '../utils';
import { RoomGlossaryPage } from '../../pages/RoomGlossaryPage';

vi.mock('../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../../hooks/useSession', () => ({ useSession: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);
const sessionMock = vi.mocked(useSession);
type SessionState = ReturnType<typeof useSession>;

function rawEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g1',
    term: 'Nebbia',
    aliases: ['La Foschia'],
    definition: 'Una **coltre** mortale.',
    visibility: 'room',
    selective_user_ids: [],
    highlight: true,
    tag_ids: ['tag-1'],
    documents: [{ id: 'doc-1', name: 'Il Castello' }],
    created_at: '2026-11-27T10:00:00Z',
    updated_at: '2026-11-27T10:00:00Z',
    can_edit: true,
    can_delete: true,
    ...overrides,
  };
}

const state = { entries: [] as unknown[], role: 'master' as 'master' | 'player' };

function render(route = '/rooms/room-1/glossary') {
  renderWithProviders(
    <Routes>
      <Route path="/rooms/:roomId/glossary" element={<RoomGlossaryPage />} />
    </Routes>,
    { route },
  );
  return { user: userEvent.setup() };
}

beforeEach(() => {
  fetchMock.mockReset();
  state.entries = [
    rawEntry(),
    rawEntry({ id: 'g2', term: 'Ordine', aliases: [], tag_ids: [], documents: [], definition: '' }),
  ];
  state.role = 'master';
  sessionMock.mockReturnValue({ session: fakeSession('user-1'), loading: false } as SessionState);
  fetchMock.mockImplementation((path: string) => {
    if (path === '/rooms/room-1/glossary') return Promise.resolve(state.entries);
    if (path === '/rooms/room-1/members')
      return Promise.resolve([rawMember({ user_id: 'user-1', role: state.role, is_admin: state.role === 'master' })]);
    if (path === '/rooms/room-1') return Promise.resolve(rawRoom());
    if (path === '/rooms/room-1/tags')
      return Promise.resolve([{ id: 'tag-1', name: 'Regola', category: null, main_position: null }]);
    if (path === '/account') return Promise.resolve(rawAccount());
    return Promise.resolve([]);
  });
});

describe('RoomGlossaryPage', () => {
  it('asks to sign in without a session', () => {
    sessionMock.mockReturnValue({ session: null, loading: false } as SessionState);
    render();
    expect(screen.getByText('Accedi per leggere il Glossario.')).toBeInTheDocument();
  });

  it('lists the terms by letter with their aliases, Tags and linked Documents', async () => {
    render();

    const entries = await screen.findAllByTestId('glossary-entry');
    expect(entries.map((entry) => within(entry).getByRole('heading').textContent)).toEqual(['Nebbia', 'Ordine']);
    expect(screen.getByRole('heading', { name: 'N' })).toBeInTheDocument();
    expect(within(entries[0]!).getByText('La Foschia')).toBeInTheDocument();
    expect(within(entries[0]!).getByText('#Regola')).toBeInTheDocument();
    expect(within(entries[0]!).getByRole('link', { name: 'Il Castello' })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents/doc-1',
    );
  });

  it('filters by a typed word, aliases included', async () => {
    const { user } = render();
    await screen.findAllByTestId('glossary-entry');

    await user.type(screen.getByLabelText('Filtra i termini'), 'fosch');

    expect(screen.getAllByTestId('glossary-entry')).toHaveLength(1);
    expect(screen.getByText('Nebbia')).toBeInTheDocument();
  });

  it('gives a Player no way to add, edit or delete', async () => {
    state.role = 'player';
    state.entries = [rawEntry({ can_edit: false, can_delete: false })];
    render();

    await screen.findByTestId('glossary-entry');
    expect(screen.queryByRole('button', { name: 'Nuovo termine' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Modifica Nebbia/ })).not.toBeInTheDocument();
  });

  it('defines a new term, and shows the refusal for a word already taken', async () => {
    const { user } = render();
    await screen.findAllByTestId('glossary-entry');
    fetchMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === '/rooms/room-1/glossary' && init?.method === 'POST') {
        return Promise.reject(new ApiError(409, 'Questa parola è già definita nel glossario'));
      }
      return Promise.resolve([]);
    });

    await user.click(screen.getByRole('button', { name: 'Nuovo termine' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Termine/), 'Nebbia');
    await user.click(within(dialog).getByRole('button', { name: 'Aggiungi termine' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Questa parola è già definita nel glossario');
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[1]).toMatchObject({ json: { term: 'Nebbia', visibility: 'room', highlight: true } });
  });

  it('deletes an entry after a confirmation', async () => {
    const { user } = render();
    await screen.findAllByTestId('glossary-entry');

    await user.click(screen.getByRole('button', { name: 'Elimina Nebbia' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Elimina' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/glossary/g1', { method: 'DELETE' }),
    );
  });

  it('shows a loader while the session loads', () => {
    sessionMock.mockReturnValue({ session: null, loading: true } as SessionState);
    render();
    expect(screen.queryByText('Accedi per leggere il Glossario.')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('scrolls to the entry named in the address', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render('/rooms/room-1/glossary?entry=g2');

    await screen.findAllByTestId('glossary-entry');
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it('says so when nothing is defined yet', async () => {
    state.entries = [];
    render();
    expect(await screen.findByText(/Nessun termine/i)).toBeInTheDocument();
  });

  it('shows an error when the entries fail to load', async () => {
    fetchMock.mockImplementation((path: string) =>
      path === '/rooms/room-1/glossary' ? Promise.reject(new Error('no')) : Promise.resolve([]),
    );
    render();
    expect(await screen.findByText(/non è stato possibile|errore|impossibile/i)).toBeInTheDocument();
  });

  it('shows no results for a word nothing matches', async () => {
    const { user } = render();
    await screen.findAllByTestId('glossary-entry');

    await user.type(screen.getByLabelText('Filtra i termini'), 'zzzz');

    expect(screen.queryAllByTestId('glossary-entry')).toHaveLength(0);
    expect(screen.getByText('Nessun risultato')).toBeInTheDocument();
  });

  it('renders the entries before Tags, Documents and Members arrive', async () => {
    fetchMock.mockImplementation((path: string) =>
      path === '/rooms/room-1/glossary' ? Promise.resolve(state.entries) : new Promise(() => {}),
    );
    render();
    expect(await screen.findAllByTestId('glossary-entry')).toHaveLength(2);
  });

  it('edits an entry and sends the change', async () => {
    const { user } = render();
    await screen.findAllByTestId('glossary-entry');

    await user.click(screen.getByRole('button', { name: 'Modifica Nebbia' }));
    const dialog = await screen.findByRole('dialog');
    const term = within(dialog).getByLabelText(/^Termine/);
    await user.clear(term);
    await user.type(term, 'Foschia');
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch?.[0]).toBe('/rooms/room-1/glossary/g1');
      expect(patch?.[1]).toMatchObject({ json: { term: 'Foschia' } });
    });
  });

  it('renders nothing without a Room in the address', () => {
    renderWithProviders(<RoomGlossaryPage />, { route: '/' });
    expect(screen.queryByText('Glossario')).not.toBeInTheDocument();
  });

  it('invites a Player to wait when nothing is defined, and a Master to add the first term', async () => {
    state.entries = [];
    state.role = 'player';
    render();
    expect(await screen.findByText(/non è ancora definito nessun termine/)).toBeInTheDocument();
  });

  it('marks an entry that only some members see', async () => {
    state.entries = [rawEntry({ visibility: 'master' })];
    render();
    await screen.findByTestId('glossary-entry');
    expect(screen.getByTestId('glossary-entry')).toHaveTextContent(/Master/);
  });

  it('starts a new term as Room-visible while the Room settings load', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path === '/rooms/room-1/glossary') return Promise.resolve(state.entries);
      if (path === '/rooms/room-1/members')
        return Promise.resolve([rawMember({ user_id: 'user-1', role: 'master', is_admin: true })]);
      return new Promise(() => {});
    });
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Nuovo termine' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows a plain message when saving fails for a reason the server did not give', async () => {
    const { user } = render();
    await screen.findAllByTestId('glossary-entry');
    fetchMock.mockImplementation((_path: string, init?: { method?: string }) =>
      init?.method === 'PATCH' ? Promise.reject(new Error('boom')) : Promise.resolve([]),
    );

    await user.click(screen.getByRole('button', { name: 'Modifica Nebbia' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Impossibile salvare il termine.');
  });

  it('closes the edit after the server answers that the entry is now hidden', async () => {
    const { user } = render();
    await screen.findAllByTestId('glossary-entry');
    fetchMock.mockImplementation((_path: string, init?: { method?: string }) =>
      init?.method === 'PATCH' ? Promise.resolve(null) : Promise.resolve([]),
    );

    await user.click(screen.getByRole('button', { name: 'Modifica Nebbia' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows why a delete failed', async () => {
    const { user } = render();
    await screen.findAllByTestId('glossary-entry');
    fetchMock.mockImplementation((_path: string, init?: { method?: string }) =>
      init?.method === 'DELETE' ? Promise.reject(new Error('boom')) : Promise.resolve([]),
    );

    await user.click(screen.getByRole('button', { name: 'Elimina Nebbia' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Elimina' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Impossibile eliminare il termine.');
  });

  it('defines a new term and closes the form', async () => {
    const { user } = render();
    await screen.findAllByTestId('glossary-entry');
    fetchMock.mockImplementation((_path: string, init?: { method?: string }) =>
      init?.method === 'POST' ? Promise.resolve(rawEntry({ id: 'g3', term: 'Lupo' })) : Promise.resolve([]),
    );

    await user.click(screen.getByRole('button', { name: 'Nuovo termine' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Termine/), 'Lupo');
    await user.click(within(dialog).getByRole('button', { name: 'Aggiungi termine' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
