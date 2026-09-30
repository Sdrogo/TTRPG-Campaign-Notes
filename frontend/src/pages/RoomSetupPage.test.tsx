import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { notifyError, notifySuccess } from '../lib/notify';
import { useSession } from '../hooks/useSession';
import { fakeSession, rawAccount, rawMember } from '../test/fixtures';
import { renderWithProviders } from '../test/utils';
import { RoomMembersRedirect, RoomSetupPage } from './RoomSetupPage';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../lib/notify', () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));
vi.mock('../hooks/useSession', () => ({ useSession: vi.fn() }));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}));

const fetchMock = vi.mocked(apiFetch);
const sessionMock = vi.mocked(useSession);

type SessionState = ReturnType<typeof useSession>;

const rawTags = [
  { id: 'npc', name: 'NPC', category: 'Type', main_position: 0 },
  { id: 'pc', name: 'PC', category: 'Type', main_position: 1 },
  { id: 'place', name: 'Luogo', category: null, main_position: null },
];

interface Routes_ {
  members: unknown;
  tags: unknown;
  put: () => Promise<unknown>;
}

const routes: Routes_ = {
  members: [],
  tags: rawTags,
  put: () => Promise.resolve(rawTags),
};

function setMembers(list: unknown[]) {
  routes.members = list;
}

function render() {
  renderWithProviders(
    <Routes>
      <Route path="/rooms/:roomId/setup" element={<RoomSetupPage />} />
    </Routes>,
    { route: '/rooms/room-1/setup' },
  );
  return { user: userEvent.setup() };
}

beforeEach(() => {
  fetchMock.mockReset();
  navigate.mockReset();
  vi.mocked(notifyError).mockClear();
  vi.mocked(notifySuccess).mockClear();
  routes.tags = rawTags;
  routes.put = () => Promise.resolve(rawTags);
  setMembers([rawMember({ user_id: 'user-1', display_name: 'Io', is_admin: true })]);
  sessionMock.mockReturnValue({
    session: fakeSession('user-1'),
    loading: false,
  } as SessionState);
  fetchMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/rooms/room-1/members') return Promise.resolve(routes.members);
    if (path === '/rooms/room-1/tags/main' && init?.method === 'PUT') return routes.put();
    if (path === '/rooms/room-1/tags') return Promise.resolve(routes.tags);
    if (path === '/account') return Promise.resolve(rawAccount());
    return Promise.resolve(undefined);
  });
});

const tagsWereRequested = () =>
  fetchMock.mock.calls.some(([path]) => path === '/rooms/room-1/tags');

describe('RoomSetupPage', () => {
  it('waits on a loader while the session is resolving', () => {
    sessionMock.mockReturnValue({
      session: null,
      loading: true,
    } as SessionState);

    const { container } = renderWithProviders(
      <Routes>
        <Route path="/rooms/:roomId/setup" element={<RoomSetupPage />} />
      </Routes>,
      { route: '/rooms/room-1/setup' },
    );

    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
  });

  // Guards against a route reached with no Room id at all, which the app
  // itself never links to but a malformed URL could.
  it('renders nothing without a Room id in the URL', () => {
    renderWithProviders(
      <Routes>
        <Route path="/setup" element={<RoomSetupPage />} />
      </Routes>,
      { route: '/setup' },
    );

    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks an anonymous visitor to sign in', () => {
    sessionMock.mockReturnValue({
      session: null,
      loading: false,
    } as SessionState);
    render();

    expect(screen.getByText('Accedi per gestire questa Stanza.')).toBeInTheDocument();
  });

  it('reports a failed load', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render();

    expect(
      await screen.findByText('Errore nel caricamento delle impostazioni della Stanza.'),
    ).toBeInTheDocument();
  });

  // Spec 11: the setup is for the Room's Administrators only. The page
  // must not even fetch what it would show.
  it('turns away a member who is not an Administrator', async () => {
    setMembers([
      rawMember({ user_id: 'user-1', display_name: 'Io', is_admin: false }),
      rawMember({ user_id: 'user-2', display_name: 'Altro', is_admin: true }),
    ]);
    render();

    expect(
      await screen.findByText('Solo un Amministratore della Stanza può aprire le impostazioni.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(tagsWereRequested()).toBe(false);
  });

  it('shows an Administrator the members and the Main Tags', async () => {
    render();

    expect(
      await screen.findByRole('heading', { name: 'Impostazioni della Stanza' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Io')).toBeInTheDocument();
    expect(await screen.findByText('1. #NPC')).toBeInTheDocument();
    expect(screen.getByText('2. #PC')).toBeInTheDocument();
  });

  it('goes home after the Administrator leaves the Room', async () => {
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Esci' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
  });

  it('reports a failed Tags load', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path === '/rooms/room-1/members') return Promise.resolve(routes.members);
      if (path === '/account') return Promise.resolve(rawAccount());
      return Promise.reject(new Error('offline'));
    });
    render();

    expect(
      await screen.findByText('Errore nel caricamento delle impostazioni della Stanza.'),
    ).toBeInTheDocument();
  });

  it('saves a new order and confirms it', async () => {
    routes.put = () =>
      Promise.resolve([
        { id: 'npc', name: 'NPC', category: 'Type', main_position: 1 },
        { id: 'pc', name: 'PC', category: 'Type', main_position: 0 },
        rawTags[2],
      ]);
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Sposta NPC giù' }));
    await user.click(screen.getByRole('button', { name: 'Salva ordine' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags/main', {
        method: 'PUT',
        json: { tag_ids: ['pc', 'npc'] },
      }),
    );
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Tag principali salvati'));
    // The saved order becomes the list, with nothing left to save.
    expect(await screen.findByText('1. #PC')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salva ordine' })).toBeDisabled();
  });

  it('surfaces a rejected save and keeps the draft', async () => {
    routes.put = () => Promise.reject(new Error('no'));
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Sposta NPC giù' }));
    await user.click(screen.getByRole('button', { name: 'Salva ordine' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(notifySuccess).not.toHaveBeenCalled();
    expect(screen.getByText('1. #PC')).toBeInTheDocument();
  });
});

describe('RoomMembersRedirect', () => {
  it('sends the old members URL to the setup page', () => {
    renderWithProviders(
      <Routes>
        <Route path="/rooms/:roomId/members" element={<RoomMembersRedirect />} />
        <Route path="/rooms/:roomId/setup" element={<div>setup page</div>} />
      </Routes>,
      { route: '/rooms/room-1/members' },
    );

    expect(screen.getByText('setup page')).toBeInTheDocument();
  });
});
