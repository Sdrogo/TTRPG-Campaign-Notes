import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { useSession } from '../../hooks/useSession';
import { ViewAsContext } from '../../hooks/useViewAs';
import { fakeSession, rawAccount, rawMember, rawRoom, rawSection, rawSections } from '../fixtures';
import { renderWithProviders } from '../utils';
import { RoomLandingPage } from '../../pages/RoomLandingPage';

vi.mock('../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../../hooks/useSession', () => ({ useSession: vi.fn() }));
vi.mock('../../lib/roomEvents', () => ({ readRoomEvents: vi.fn(() => new Promise<void>(() => {})) }));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}));

const fetchMock = vi.mocked(apiFetch);
const sessionMock = vi.mocked(useSession);
type SessionState = ReturnType<typeof useSession>;

const routes = {
  sections: (): Promise<unknown> => Promise.resolve(rawSections([rawSection({ description: 'Neon' })])),
  room: (): Promise<unknown> => Promise.resolve(rawRoom()),
  members: [rawMember()] as unknown,
};

function render(previewing = false) {
  renderWithProviders(
    <Routes>
      <Route path="/rooms/:roomId" element={<RoomLandingPage />} />
    </Routes>,
    {
      route: '/rooms/room-1',
      wrapper: previewing
        ? ({ children }) => <ViewAsContext.Provider value={{ roomId: 'room-1', userId: 'user-2' }}>{children}</ViewAsContext.Provider>
        : undefined,
    },
  );
  return userEvent.setup();
}

const master = () => [rawMember({ role: 'master', is_admin: true }), rawMember({ user_id: 'user-2', display_name: 'Alice' })];

beforeEach(() => {
  fetchMock.mockReset();
  navigate.mockReset();
  routes.sections = () => Promise.resolve(rawSections([rawSection({ description: 'Neon' })]));
  routes.room = () => Promise.resolve(rawRoom());
  routes.members = [rawMember()];
  sessionMock.mockReturnValue({ session: fakeSession('user-1'), loading: false } as SessionState);
  fetchMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/rooms/room-1/sections') return routes.sections();
    if (path === '/rooms/room-1/members' && !init?.method) return Promise.resolve(routes.members);
    if (path === '/rooms/room-1') return routes.room();
    if (path === '/account') return Promise.resolve(rawAccount());
    return Promise.resolve([]);
  });
});

describe('RoomLandingPage', () => {
  it('waits for the session, asks to sign in, and needs a Room', () => {
    sessionMock.mockReturnValue({ session: null, loading: true } as SessionState);
    const { container } = renderWithProviders(
      <Routes>
        <Route path="/rooms/:roomId" element={<RoomLandingPage />} />
      </Routes>,
      { route: '/rooms/room-1' },
    );
    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
  });

  it('asks to sign in without a session', () => {
    sessionMock.mockReturnValue({ session: null, loading: false } as SessionState);
    render();
    expect(screen.getByText('Accedi per vedere i Documenti di questa Stanza.')).toBeInTheDocument();
  });

  it('renders nothing without a Room in the URL', () => {
    renderWithProviders(<RoomLandingPage />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the Room's Section cards to a Player, without editing", async () => {
    render();
    expect(screen.getByRole('heading', { level: 1, name: 'Home della Stanza' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'La Cripta' })).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Tokyo' })).toHaveAttribute('href', '/rooms/room-1/sections/section-1');
    expect(screen.getByRole('link', { name: 'Documenti' })).toHaveAttribute('href', '/rooms/room-1/documents');
    expect(screen.getByText('Sessioni, Linee e Veli, sondaggi')).toBeInTheDocument();
    expect(screen.getByText('Neon')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifica' })).not.toBeInTheDocument();
  });

  it('says when the landing fails to load', async () => {
    routes.sections = () => Promise.reject(new Error('no'));
    render();
    expect(await screen.findByText('Impossibile caricare la pagina.')).toBeInTheDocument();
  });

  it('lets the Master edit the landing in place', async () => {
    routes.members = master();
    const user = render();
    await user.click(await screen.findByRole('button', { name: 'Modifica' }));
    expect(screen.getByRole('button', { name: 'Nuova sezione' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sposta Tokyo' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fine' }));
    expect(screen.queryByRole('button', { name: 'Nuova sezione' })).not.toBeInTheDocument();
  });

  it('offers no editing on an empty landing', async () => {
    routes.members = master();
    routes.sections = () => Promise.resolve([]);
    render();
    await screen.findByRole('button', { name: 'Azioni per la Stanza La Cripta' });
    expect(screen.queryByRole('button', { name: 'Modifica' })).not.toBeInTheDocument();
  });

  it('only reads while the Master previews the Room as a member', async () => {
    routes.members = master();
    render(true);
    expect(await screen.findByRole('link', { name: 'Tokyo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifica' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Azioni per la Stanza La Cripta' })).not.toBeInTheDocument();
  });

  it('takes the member back to their Rooms after leaving', async () => {
    const user = render();
    await user.click(await screen.findByRole('button', { name: 'Azioni per la Stanza La Cripta' }));
    await user.click(screen.getByRole('button', { name: 'Esci' }));
    const dialog = await screen.findByRole('dialog', { name: 'Uscire da "La Cripta"?' });
    await user.click(within(dialog).getByRole('button', { name: 'Esci' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/rooms'));
  });
});
