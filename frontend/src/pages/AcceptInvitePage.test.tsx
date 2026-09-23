import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { useSession } from '../hooks/useSession';
import { fakeSession, rawRoom } from '../test/fixtures';
import { renderWithProviders } from '../test/utils';
import { AcceptInvitePage } from './AcceptInvitePage';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../hooks/useSession', () => ({ useSession: vi.fn() }));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}));

const fetchMock = vi.mocked(apiFetch);
const sessionMock = vi.mocked(useSession);

type SessionState = ReturnType<typeof useSession>;

// Rendered on its route, so `useParams` sees the invite code.
function render(code = 'ABC123') {
  renderWithProviders(
    <Routes>
      <Route path="/invite/:code" element={<AcceptInvitePage />} />
    </Routes>,
    { route: `/invite/${code}` },
  );
  return { user: userEvent.setup() };
}

beforeEach(() => {
  fetchMock.mockReset();
  navigate.mockReset();
  sessionMock.mockReturnValue({ session: fakeSession(), loading: false } as SessionState);
});

describe('AcceptInvitePage', () => {
  it('waits on a loader while the session is resolving', () => {
    sessionMock.mockReturnValue({ session: null, loading: true } as SessionState);

    const { container } = renderWithProviders(
      <Routes>
        <Route path="/invite/:code" element={<AcceptInvitePage />} />
      </Routes>,
      { route: '/invite/ABC123' },
    );

    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The invite link is the first thing a new member opens, so it has to send
  // them to sign in rather than silently failing.
  it('asks an anonymous visitor to sign in first', () => {
    sessionMock.mockReturnValue({ session: null, loading: false } as SessionState);
    render();

    expect(screen.getByText('Accedi per unirti a questa Stanza.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vai al login' })).toHaveAttribute('href', '/');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts the invitation in the URL as soon as it can', async () => {
    fetchMock.mockResolvedValue(rawRoom());
    render('XYZ789');

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/invitations/XYZ789/accept', { method: 'POST' }),
    );
  });

  it('names the Room that was joined', async () => {
    fetchMock.mockResolvedValue(rawRoom());
    render();

    expect(await screen.findByText('Ti sei unito a "La Cripta"')).toBeInTheDocument();
  });

  it('goes to the Rooms list from the success screen', async () => {
    fetchMock.mockResolvedValue(rawRoom());
    const { user } = render();
    await screen.findByText(/Ti sei unito a/);

    await user.click(screen.getByRole('button', { name: 'Vai alle mie Stanze' }));

    expect(navigate).toHaveBeenCalledWith('/');
  });

  // Expired, already used, or simply wrong: one message, and a way out.
  it('reports a rejected invitation with a way back', async () => {
    fetchMock.mockRejectedValue(new Error('Invitation expired'));
    render();

    expect(
      await screen.findByText('Invito non valido, scaduto o già utilizzato.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Torna alle mie Stanze' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  // The effect reruns whenever the mutation object changes identity; a guard
  // ref keeps that from firing a second POST for the same code.
  it('accepts only once', async () => {
    fetchMock.mockResolvedValue(rawRoom());
    render();
    await screen.findByText(/Ti sei unito a/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
