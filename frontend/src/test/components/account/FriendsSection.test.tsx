import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/apiClient';
import { notifyError, notifySuccess } from '../../../lib/notify';
import { rawFriend, rawFriends } from '../../fixtures';
import { renderWithProviders } from '../../utils';
import { FriendsSection } from '../../../components/account/FriendsSection';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

type Init = { method?: string } | undefined;
type Handler = (path: string, init: Init) => Promise<unknown> | undefined;

/**
 * Serves the Friend code and these Friends lists; `handler` answers the
 * writes (anything it leaves undefined resolves empty).
 */
function serve(friends: unknown, handler: Handler = () => undefined) {
  fetchMock.mockImplementation((path: string, init?: Init) => {
    const handled = handler(path, init);
    if (handled) return handled;
    if (path === '/friends') return Promise.resolve(friends);
    if (path === '/account/friend-code') {
      return Promise.resolve({ code: 'FRIEND1', created_at: '2026-10-01T12:00:00Z' });
    }
    return Promise.resolve(undefined);
  });
}

function render() {
  renderWithProviders(<FriendsSection />);
  return { user: userEvent.setup() };
}

const incoming = rawFriend({ friendship_id: 'friendship-in', user_id: 'user-3', display_name: 'Terzo' });
const outgoing = rawFriend({ friendship_id: 'friendship-out', user_id: 'user-4', display_name: 'Quarto' });

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(notifyError).mockClear();
  vi.mocked(notifySuccess).mockClear();
});

describe('FriendsSection', () => {
  it('shows the friend link built from the code', async () => {
    serve(rawFriends());
    render();

    expect(
      await screen.findByDisplayValue(`${window.location.origin}/friends/add/FRIEND1`),
    ).toHaveAttribute('readonly');
  });

  it('copies the friend link', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    serve(rawFriends());
    const { user } = render();
    await screen.findByDisplayValue(/FRIEND1/);

    await user.click(screen.getByRole('button', { name: 'Copia' }));

    expect(await screen.findByRole('button', { name: 'Copiato' })).toBeInTheDocument();
  });

  it('regenerates the link and shows the new one', async () => {
    serve(rawFriends(), (path, init) =>
      path === '/account/friend-code' && init?.method === 'POST'
        ? Promise.resolve({ code: 'FRIEND2', created_at: '2026-10-02T12:00:00Z' })
        : undefined,
    );
    const { user } = render();
    await screen.findByDisplayValue(/FRIEND1/);

    await user.click(screen.getByRole('button', { name: 'Rigenera' }));

    expect(await screen.findByDisplayValue(/FRIEND2/)).toBeInTheDocument();
    expect(notifySuccess).toHaveBeenCalledWith(
      'Nuovo link creato: quello vecchio non funziona più.',
    );
  });

  it('reports a failed regeneration', async () => {
    serve(rawFriends(), (path, init) =>
      path === '/account/friend-code' && init?.method === 'POST'
        ? Promise.reject(new Error('boom'))
        : undefined,
    );
    const { user } = render();
    await screen.findByDisplayValue(/FRIEND1/);

    await user.click(screen.getByRole('button', { name: 'Rigenera' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });

  it('says when the link cannot be loaded', async () => {
    serve(rawFriends(), (path) =>
      path === '/account/friend-code' ? Promise.reject(new Error('offline')) : undefined,
    );
    render();

    expect(await screen.findByText('Impossibile caricare il tuo link amico.')).toBeInTheDocument();
  });

  it('says when the Friends cannot be loaded', async () => {
    serve(rawFriends(), (path) =>
      path === '/friends' ? Promise.reject(new Error('offline')) : undefined,
    );
    render();

    expect(await screen.findByText('Impossibile caricare i tuoi amici.')).toBeInTheDocument();
  });

  it('invites to share the link while there are no Friends', async () => {
    serve(rawFriends());
    render();

    expect(await screen.findByText(/Nessun amico per ora/)).toBeInTheDocument();
    // Nothing pending, so no request lists either.
    expect(screen.queryByText('Richieste ricevute')).not.toBeInTheDocument();
    expect(screen.queryByText('Richieste inviate')).not.toBeInTheDocument();
  });

  it('lists Friends, requests received and requests sent', async () => {
    serve(
      rawFriends({
        friends: [rawFriend({ email: 'altro@example.com', pronouns: 'lui' })],
        incoming: [incoming],
        outgoing: [outgoing],
      }),
    );
    render();

    expect(await screen.findByText('Altro')).toBeInTheDocument();
    // The email only comes when the two share a Room; the backend decides.
    expect(screen.getByText('altro@example.com')).toBeInTheDocument();
    expect(screen.getByText('lui')).toBeInTheDocument();
    expect(screen.getByText('Richieste ricevute')).toBeInTheDocument();
    expect(screen.getByText('Terzo')).toBeInTheDocument();
    expect(screen.getByText('Richieste inviate')).toBeInTheDocument();
    expect(screen.getByText('Quarto')).toBeInTheDocument();
  });

  it('does not repeat the email when it is already the name shown', async () => {
    serve(rawFriends({ friends: [rawFriend({ display_name: null, email: 'altro@example.com' })] }));
    render();

    expect(await screen.findAllByText('altro@example.com')).toHaveLength(1);
  });

  it('accepts a request and confirms the new Friend', async () => {
    serve(rawFriends({ incoming: [incoming] }), (path) =>
      path === '/friends/requests/friendship-in/accept' ? Promise.resolve(incoming) : undefined,
    );
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Accetta' }));

    await waitFor(() =>
      expect(notifySuccess).toHaveBeenCalledWith('Ora tu e Terzo siete amici.'),
    );
  });

  it('reports a failed acceptance', async () => {
    serve(rawFriends({ incoming: [incoming] }), (path) =>
      path.endsWith('/accept') ? Promise.reject(new Error('gone')) : undefined,
    );
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Accetta' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });

  it('declines a request', async () => {
    serve(rawFriends({ incoming: [incoming] }));
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Rifiuta' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/friends/requests/friendship-in/decline', {
        method: 'POST',
      }),
    );
  });

  it('cancels a request sent', async () => {
    serve(rawFriends({ outgoing: [outgoing] }));
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Annulla richiesta' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/friends/user-4', { method: 'DELETE' }),
    );
  });

  it('removes a Friend only after confirming', async () => {
    serve(rawFriends({ friends: [rawFriend()] }));
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Rimuovi' }));
    expect(await screen.findByText('Rimuovere Altro dagli amici?')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/friends/user-2', { method: 'DELETE' });

    const confirm = screen.getAllByRole('button', { name: 'Rimuovi' }).at(-1) as HTMLElement;
    await user.click(confirm);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/friends/user-2', { method: 'DELETE' }),
    );
  });

  it('keeps the Friend when the removal is called off', async () => {
    serve(rawFriends({ friends: [rawFriend()] }));
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Rimuovi' }));
    await user.click(await screen.findByRole('button', { name: 'Annulla' }));

    await waitFor(() =>
      expect(screen.queryByText('Rimuovere Altro dagli amici?')).not.toBeInTheDocument(),
    );
    expect(fetchMock).not.toHaveBeenCalledWith('/friends/user-2', { method: 'DELETE' });
  });

  it('shows loading only on the row being changed', async () => {
    let finish!: () => void;
    const pending = new Promise<undefined>((resolve) => {
      finish = () => resolve(undefined);
    });
    const other = rawFriend({ friendship_id: 'friendship-5', user_id: 'user-5', display_name: 'Quinto' });
    serve(rawFriends({ outgoing: [outgoing, other] }), (_path, init) =>
      init?.method === 'DELETE' ? pending : undefined,
    );
    const { user } = render();
    await screen.findByText('Quinto');
    const [first, second] = screen.getAllByRole('button', { name: 'Annulla richiesta' });

    await user.click(first);

    await waitFor(() => expect(first).toHaveAttribute('data-loading'));
    expect(second).not.toHaveAttribute('data-loading');
    finish();
  });
});
