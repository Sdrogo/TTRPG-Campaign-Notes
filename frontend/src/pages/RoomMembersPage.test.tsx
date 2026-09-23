import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { notifyError } from '../lib/notify';
import { useSession } from '../hooks/useSession';
import { fakeSession, rawAccount, rawMember } from '../test/fixtures';
import { renderWithProviders } from '../test/utils';
import { RoomMembersPage } from './RoomMembersPage';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock('../hooks/useSession', () => ({ useSession: vi.fn() }));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}));

const fetchMock = vi.mocked(apiFetch);
const sessionMock = vi.mocked(useSession);

type SessionState = ReturnType<typeof useSession>;

// `members` is the list the page renders; everything else (the account
// avatar in the header) gets a profile.
function mockMembers(list: unknown[], onWrite: (path: string) => Promise<unknown> = () => Promise.resolve()) {
  fetchMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/rooms/room-1/members' && !init?.method) return Promise.resolve(list);
    if (path === '/account') return Promise.resolve(rawAccount());
    return onWrite(path);
  });
}

function render() {
  renderWithProviders(
    <Routes>
      <Route path="/rooms/:roomId/members" element={<RoomMembersPage />} />
    </Routes>,
    { route: '/rooms/room-1/members' },
  );
  return { user: userEvent.setup() };
}

const rowFor = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

beforeEach(() => {
  fetchMock.mockReset();
  navigate.mockReset();
  vi.mocked(notifyError).mockClear();
  sessionMock.mockReturnValue({ session: fakeSession('user-1'), loading: false } as SessionState);
});

describe('RoomMembersPage', () => {
  it('waits on a loader while the session is resolving', () => {
    sessionMock.mockReturnValue({ session: null, loading: true } as SessionState);
    mockMembers([]);

    const { container } = renderWithProviders(
      <Routes>
        <Route path="/rooms/:roomId/members" element={<RoomMembersPage />} />
      </Routes>,
      { route: '/rooms/room-1/members' },
    );

    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
  });

  it('asks an anonymous visitor to sign in', () => {
    sessionMock.mockReturnValue({ session: null, loading: false } as SessionState);
    mockMembers([]);
    render();

    expect(screen.getByText('Accedi per vedere i membri di questa Stanza.')).toBeInTheDocument();
  });

  it('lists the members with their profile details', async () => {
    mockMembers([
      rawMember({ user_id: 'user-1', display_name: 'Io', pronouns: 'lei', bio: 'Due righe.' }),
      rawMember({ user_id: 'user-2', display_name: 'Narratore', role: 'master' }),
    ]);
    render();

    expect(await screen.findByText('Io')).toBeInTheDocument();
    expect(screen.getByText('lei')).toBeInTheDocument();
    expect(screen.getByText('Due righe.')).toBeInTheDocument();
    // Scoped to the row: "Master" is also the role label in that same cell.
    expect(within(rowFor('Narratore')).getByText('Master')).toBeInTheDocument();
  });

  it('marks which row is you', async () => {
    mockMembers([rawMember({ user_id: 'user-1', display_name: 'Io' })]);
    render();

    expect(await screen.findByText('Tu')).toBeInTheDocument();
  });

  it('reports a failed load', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render();

    expect(await screen.findByText('Errore nel caricamento dei membri.')).toBeInTheDocument();
  });
});

// Only an Administrator may change roles or remove others; the UI must not
// offer what the backend would reject.
describe('as an ordinary member', () => {
  beforeEach(() => {
    mockMembers([
      rawMember({ user_id: 'user-1', display_name: 'Io', is_admin: false }),
      rawMember({ user_id: 'user-2', display_name: 'Altro', role: 'master', is_admin: true }),
    ]);
  });

  it('shows roles as plain text, not as editable controls', async () => {
    render();
    await screen.findByText('Io');

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('can leave, but cannot remove anyone else', async () => {
    render();
    await screen.findByText('Io');

    expect(within(rowFor('Io')).getByRole('button', { name: 'Esci' })).toBeInTheDocument();
    expect(within(rowFor('Altro')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the admin column as text', async () => {
    render();
    await screen.findByText('Altro');

    expect(within(rowFor('Altro')).getByText('Sì')).toBeInTheDocument();
    expect(within(rowFor('Io')).getByText('—')).toBeInTheDocument();
  });
});

describe('as an Administrator', () => {
  beforeEach(() => {
    mockMembers(
      [
        rawMember({ user_id: 'user-1', display_name: 'Io', is_admin: true }),
        rawMember({ user_id: 'user-2', display_name: 'Altro' }),
      ],
      () => Promise.resolve(rawMember()),
    );
  });

  it('changes another member\'s role', async () => {
    const { user } = render();
    await screen.findByText('Altro');

    await user.click(within(rowFor('Altro')).getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Master' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/members/user-2', {
        method: 'PATCH',
        json: { role: 'master', is_admin: undefined },
      }),
    );
  });

  it('grants the Administrator flag', async () => {
    const { user } = render();
    await screen.findByText('Altro');

    await user.click(within(rowFor('Altro')).getByRole('switch'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/members/user-2', {
        method: 'PATCH',
        json: { role: undefined, is_admin: true },
      }),
    );
  });

  it('removes another member', async () => {
    const { user } = render();
    await screen.findByText('Altro');

    await user.click(within(rowFor('Altro')).getByRole('button', { name: 'Rimuovi' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/members/user-2', {
        method: 'DELETE',
      }),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  // Leaving drops the Room off your own list, so staying on its page would
  // show a 403 on the next refresh.
  it('goes home after leaving the Room yourself', async () => {
    const { user } = render();
    await screen.findByText('Io');

    await user.click(within(rowFor('Io')).getByRole('button', { name: 'Esci' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
  });

  // The backend refuses to leave a Room without a Master or Administrator;
  // the message has to reach the user rather than vanish.
  it('surfaces a rejected change', async () => {
    mockMembers(
      [rawMember({ user_id: 'user-1', display_name: 'Io', is_admin: true })],
      () => Promise.reject(new Error('A Room must keep at least one Master')),
    );
    const { user } = render();
    await screen.findByText('Io');

    await user.click(within(rowFor('Io')).getByRole('switch'));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });
});
