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

function render() {
  renderWithProviders(
    <Routes>
      <Route path="/rooms/:roomId/glossary" element={<RoomGlossaryPage />} />
    </Routes>,
    { route: '/rooms/room-1/glossary' },
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
});
