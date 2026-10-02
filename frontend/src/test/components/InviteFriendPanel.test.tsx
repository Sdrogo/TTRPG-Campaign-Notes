import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { notifyError, notifySuccess } from '../../lib/notify';
import { rawFriend, rawFriends, rawMember } from '../fixtures';
import { renderWithProviders } from '../utils';
import { InviteModal } from '../../components/InviteModal';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

type Init = { method?: string } | undefined;

/** Serves the Friends and the Room's members; `invite` answers the direct invitation. */
function serve(
  friends: unknown,
  invite: () => Promise<unknown> = () =>
    Promise.resolve({ code: 'D1', role: 'player', expires_at: null, invitee_user_id: 'user-2' }),
) {
  fetchMock.mockImplementation((path: string, init?: Init) => {
    if (path === '/friends') return Promise.resolve(friends);
    if (path === '/rooms/room-1/members') return Promise.resolve([rawMember({ user_id: 'user-1' })]);
    if (path === '/rooms/room-1/invitations/direct' && init?.method === 'POST') return invite();
    return Promise.resolve(undefined);
  });
}

/** Opens the modal on its Friends tab. */
async function openFriendsTab() {
  const user = userEvent.setup();
  renderWithProviders(<InviteModal opened onClose={vi.fn()} roomId="room-1" />);
  await user.click(screen.getByRole('tab', { name: 'Amici' }));
  return user;
}

const friendPicker = () => screen.getByRole('combobox', { name: 'Amico' });

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(notifyError).mockClear();
  vi.mocked(notifySuccess).mockClear();
});

describe('InviteModal Friends tab', () => {
  it('opens on the link tab', () => {
    serve(rawFriends());
    renderWithProviders(<InviteModal opened onClose={vi.fn()} roomId="room-1" />);

    expect(screen.getByRole('button', { name: 'Genera invito' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/friends');
  });

  it('offers only Friends who are not in the Room yet', async () => {
    serve(
      rawFriends({
        friends: [
          rawFriend({ user_id: 'user-1', display_name: 'Già dentro' }),
          rawFriend({ user_id: 'user-2', display_name: 'Altro', email: 'altro@example.com' }),
          rawFriend({ user_id: 'user-3', display_name: null, email: 'terzo@example.com' }),
        ],
      }),
    );
    const user = await openFriendsTab();
    await waitFor(() => expect(friendPicker()).toBeEnabled());

    await user.click(friendPicker());

    expect(await screen.findByRole('option', { name: 'Altro (altro@example.com)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'terzo@example.com' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Già dentro' })).not.toBeInTheDocument();
  });

  it('says when there is no Friend left to invite', async () => {
    serve(rawFriends({ friends: [rawFriend({ user_id: 'user-1' })] }));
    await openFriendsTab();

    expect(await screen.findByText(/Nessun amico da invitare/)).toBeInTheDocument();
  });

  it('says when the Friends cannot be loaded', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await openFriendsTab();

    expect(await screen.findByText('Impossibile caricare i tuoi amici.')).toBeInTheDocument();
  });

  it('sends nothing until a Friend is picked', async () => {
    serve(rawFriends({ friends: [rawFriend()] }));
    await openFriendsTab();

    expect(await screen.findByRole('button', { name: 'Invia invito' })).toBeDisabled();
  });

  it('invites the chosen Friend with the proposed role and confirms it', async () => {
    serve(rawFriends({ friends: [rawFriend()] }));
    const user = await openFriendsTab();
    await waitFor(() => expect(friendPicker()).toBeEnabled());

    await user.click(friendPicker());
    await user.click(await screen.findByRole('option', { name: 'Altro' }));
    await user.click(screen.getByRole('combobox', { name: 'Ruolo proposto' }));
    await user.click(screen.getByRole('option', { name: 'Master' }));
    await user.click(screen.getByRole('button', { name: 'Invia invito' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/invitations/direct', {
        method: 'POST',
        json: { user_id: 'user-2', role: 'master' },
      }),
    );
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Invito inviato a Altro.'));
    // Ready for the next Friend.
    expect(friendPicker()).toHaveValue('');
  });

  it('reports a refused invitation', async () => {
    serve(rawFriends({ friends: [rawFriend()] }), () => Promise.reject(new Error('Not a Friend')));
    const user = await openFriendsTab();
    await waitFor(() => expect(friendPicker()).toBeEnabled());

    await user.click(friendPicker());
    await user.click(await screen.findByRole('option', { name: 'Altro' }));
    await user.click(screen.getByRole('button', { name: 'Invia invito' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });
});
