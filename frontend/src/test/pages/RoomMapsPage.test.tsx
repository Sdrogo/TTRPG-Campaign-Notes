import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../lib/apiClient';
import { useSession } from '../../hooks/useSession';
import { ViewAsContext } from '../../hooks/useViewAs';
import { fakeSession, rawAccount, rawMap, rawMapDetail, rawMember, rawRoom } from '../fixtures';
import { renderWithProviders } from '../utils';
import { RoomMapsPage } from '../../pages/RoomMapsPage';

vi.mock('../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../../hooks/useSession', () => ({ useSession: vi.fn() }));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}));

const fetchMock = vi.mocked(apiFetch);
const sessionMock = vi.mocked(useSession);
type SessionState = ReturnType<typeof useSession>;

const routes = {
  maps: () => Promise.resolve([rawMap(), rawMap({ id: 'map-2', name: 'Vuota', description: '', document_count: 1 })]) as Promise<unknown>,
  create: () => Promise.resolve(rawMapDetail({ id: 'map-9' })) as Promise<unknown>,
  room: rawRoom() as unknown,
  members: [rawMember({ user_id: 'user-1', role: 'player' })] as unknown,
};

function render(previewing = false) {
  renderWithProviders(
    <Routes>
      <Route path="/rooms/:roomId/maps" element={<RoomMapsPage />} />
      <Route path="/rooms/:roomId" element={<RoomMapsPage />} />
    </Routes>,
    {
      route: '/rooms/room-1/maps',
      wrapper: previewing
        ? ({ children }) => (
            <ViewAsContext.Provider value={{ roomId: 'room-1', userId: 'user-2' }}>{children}</ViewAsContext.Provider>
          )
        : undefined,
    },
  );
  return { user: userEvent.setup() };
}

beforeEach(() => {
  fetchMock.mockReset();
  navigate.mockReset();
  routes.maps = () => Promise.resolve([rawMap(), rawMap({ id: 'map-2', name: 'Vuota', description: '', document_count: 1 })]);
  routes.create = () => Promise.resolve(rawMapDetail({ id: 'map-9' }));
  routes.room = rawRoom();
  routes.members = [rawMember({ user_id: 'user-1', role: 'player' })];
  sessionMock.mockReturnValue({ session: fakeSession('user-1'), loading: false } as SessionState);
  fetchMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/rooms/room-1/maps' && init?.method === 'POST') return routes.create();
    if (path === '/rooms/room-1/maps') return routes.maps();
    if (path === '/rooms/room-1/members') return Promise.resolve(routes.members);
    if (path === '/rooms/room-1') return Promise.resolve(routes.room);
    if (path === '/account') return Promise.resolve(rawAccount());
    return Promise.resolve([]);
  });
});

describe('RoomMapsPage', () => {
  it('waits for the session, then asks to sign in without one', () => {
    sessionMock.mockReturnValue({ session: null, loading: true } as SessionState);
    const { container } = renderWithProviders(
      <Routes>
        <Route path="/rooms/:roomId/maps" element={<RoomMapsPage />} />
      </Routes>,
      { route: '/rooms/room-1/maps' },
    );
    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
  });

  it('asks to sign in without a session', () => {
    sessionMock.mockReturnValue({ session: null, loading: false } as SessionState);
    render();
    expect(screen.getByText('Accedi per vedere le mappe di questa Stanza.')).toBeInTheDocument();
  });

  it('renders nothing without a Room in the URL', () => {
    renderWithProviders(<RoomMapsPage />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists the maps with their counts, linking to each', async () => {
    render();
    const link = await screen.findByRole('link', { name: /La Corte/ });
    expect(link).toHaveAttribute('href', '/rooms/room-1/maps/map-1');
    expect(screen.getByText('Chi serve chi')).toBeInTheDocument();
    expect(screen.getByText(/2 Documenti/)).toBeInTheDocument();
    expect(screen.getByText(/1 Documento/)).toBeInTheDocument();
  });

  it('marks a geographic map in the list, and creates one (spec 38 Decision 1)', async () => {
    routes.maps = () => Promise.resolve([rawMap({ kind: 'geographic', plane_width: 2000, plane_height: 1400 })]);
    const { user } = render();
    expect(await screen.findByText('Geografica')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Nuova mappa' }));
    await user.click(screen.getByText('Mappa geografica'));
    await user.type(screen.getByRole('textbox', { name: /Nome/ }), 'Shibuya di notte');
    await user.click(screen.getAllByRole('button', { name: 'Nuova mappa' }).at(-1)!);
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/rooms/room-1/maps',
        expect.objectContaining({ method: 'POST', json: expect.objectContaining({ kind: 'geographic' }) }),
      ),
    );
  });

  it('says when there are no maps, or they could not be loaded', async () => {
    routes.maps = () => Promise.resolve([]);
    render();
    expect(await screen.findByText('Ancora nessuna mappa.')).toBeInTheDocument();
  });

  it('says when the maps could not be loaded', async () => {
    routes.maps = () => Promise.reject(new ApiError(500, 'boom'));
    render();
    expect(await screen.findByText('Impossibile caricare le mappe.')).toBeInTheDocument();
  });

  it('creates a map at the Room default visibility and opens it', async () => {
    routes.room = rawRoom({ default_visibility: 'master' });
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Nuova mappa' }));
    expect(screen.getByRole('combobox', { name: 'Visibilità' })).toHaveValue('Solo Master (e te)');
    await user.type(screen.getByRole('textbox', { name: /Nome/ }), 'Kindred');
    await user.click(screen.getAllByRole('button', { name: 'Nuova mappa' }).at(-1)!);

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/rooms/room-1/maps/map-9'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/rooms/room-1/maps',
      expect.objectContaining({ method: 'POST', json: expect.objectContaining({ name: 'Kindred', visibility: 'master' }) }),
    );
  });

  it('shows why a map could not be created, and forgets it on close', async () => {
    routes.create = () => Promise.reject(new ApiError(409, 'Troppe mappe'));
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Nuova mappa' }));
    await user.type(screen.getByRole('textbox', { name: /Nome/ }), 'Kindred');
    await user.click(screen.getAllByRole('button', { name: 'Nuova mappa' }).at(-1)!);
    expect(await screen.findByText('Troppe mappe')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Nuova mappa' }));
    expect(screen.queryByText('Troppe mappe')).not.toBeInTheDocument();
  });

  it('offers no creation when Players cannot create Documents, nor in a preview', async () => {
    routes.room = rawRoom({ players_can_create_documents: false });
    render();
    await screen.findByRole('link', { name: /La Corte/ });
    expect(screen.queryByRole('button', { name: 'Nuova mappa' })).not.toBeInTheDocument();
  });

  it('offers no creation while the Master previews a member', async () => {
    routes.members = [rawMember({ user_id: 'user-1', role: 'master' })];
    render(true);
    await screen.findByRole('link', { name: /La Corte/ });
    expect(screen.queryByRole('button', { name: 'Nuova mappa' })).not.toBeInTheDocument();
  });

  it('starts a new map at Room level until the Room loads', async () => {
    routes.room = new Promise(() => {});
    fetchMock.mockImplementation((path: string) => {
      if (path === '/rooms/room-1') return new Promise(() => {});
      if (path === '/rooms/room-1/maps') return routes.maps();
      if (path === '/rooms/room-1/members') return Promise.resolve([rawMember({ user_id: 'user-1', role: 'master' })]);
      return Promise.resolve([]);
    });
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Nuova mappa' }));
    expect(screen.getByRole('combobox', { name: 'Visibilità' })).toHaveValue('Stanza (tutti i membri)');
  });

});
