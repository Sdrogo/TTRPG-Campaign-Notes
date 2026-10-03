import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { readPendingFriendCode, savePendingFriendCode } from '../../lib/pendingInvite';
import { useSession } from '../../hooks/useSession';
import { fakeSession, rawFriend } from '../fixtures';
import { renderWithProviders } from '../utils';
import { AddFriendPage } from '../../pages/AddFriendPage';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../hooks/useSession', () => ({ useSession: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);
const sessionMock = vi.mocked(useSession);

type SessionState = ReturnType<typeof useSession>;

// Rendered on its route, so `useParams` sees the Friend code.
function render(code = 'FRIEND1') {
  return renderWithProviders(
    <Routes>
      <Route path="/friends/add/:code" element={<AddFriendPage />} />
    </Routes>,
    { route: `/friends/add/${code}` },
  );
}

beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
  sessionMock.mockReturnValue({ session: fakeSession(), loading: false } as SessionState);
});

describe('AddFriendPage', () => {
  it('waits on a loader while the session is resolving', () => {
    sessionMock.mockReturnValue({ session: null, loading: true } as SessionState);

    const { container } = render();

    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Signing in comes back to the site root, which then returns here.
  it('asks a signed-out visitor to sign in and remembers the code', async () => {
    sessionMock.mockReturnValue({ session: null, loading: false } as SessionState);

    render();

    expect(screen.getByText('Accedi per inviare la richiesta di amicizia.')).toBeInTheDocument();
    await waitFor(() => expect(readPendingFriendCode()).toBe('FRIEND1'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the request once signed in and names its recipient', async () => {
    savePendingFriendCode('FRIEND1');
    fetchMock.mockResolvedValue(rawFriend());

    render();

    expect(
      await screen.findByRole('heading', { name: 'Richiesta di amicizia inviata a Altro.' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/friends/requests', {
      method: 'POST',
      json: { code: 'FRIEND1' },
    });
    expect(readPendingFriendCode()).toBeNull();
    expect(screen.getByRole('link', { name: 'Vai al tuo account' })).toHaveAttribute(
      'href',
      '/account',
    );
  });

  it('waits on a loader while the request is on its way', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    const { container } = render();

    await waitFor(() =>
      expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument(),
    );
  });

  // The backend never sends another user's email: with no chosen name, say
  // it was sent rather than "sent to an unknown user".
  it('confirms without a name when the recipient has no chosen name', async () => {
    fetchMock.mockResolvedValue(rawFriend({ display_name: null, email: null }));

    render();

    expect(
      await screen.findByRole('heading', { name: 'Richiesta di amicizia inviata.' }),
    ).toBeInTheDocument();
  });

  it("shows the backend's reason when the request is refused", async () => {
    fetchMock.mockRejectedValue(new Error('You are already Friends'));

    render();

    expect(
      await screen.findByRole('heading', { name: 'Impossibile inviare la richiesta di amicizia.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('You are already Friends')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Torna alle mie Stanze' })).toHaveAttribute('href', '/');
  });
});
