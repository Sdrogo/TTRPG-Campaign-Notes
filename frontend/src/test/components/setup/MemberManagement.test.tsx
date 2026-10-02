import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/apiClient';
import { notifyError, notifySuccess } from '../../../lib/notify';
import { rawFriend, rawFriends, rawMember } from '../../fixtures';
import { renderWithProviders } from '../../utils';
import { MemberManagement } from '../../../components/setup/MemberManagement';
import type { Member } from '../../../types/member';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../lib/notify', () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);

/** A Member with plain-player defaults. */
const member = (overrides: Partial<Member> = {}): Member => ({
  userId: 'user-2',
  role: 'player',
  isAdmin: false,
  email: 'altro@example.com',
  displayName: 'Altro',
  pronouns: null,
  bio: null,
  avatarUrl: null,
  ...overrides,
});

/** Renders the table for user-1 and returns the leave spy and a user. */
function render(members: Member[]) {
  const onLeft = vi.fn();
  renderWithProviders(
    <MemberManagement roomId="room-1" members={members} currentUserId="user-1" onLeft={onLeft} />,
  );
  return { onLeft, user: userEvent.setup() };
}

/** The table row showing the member with this name. */
const rowFor = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

/** The signed-in Administrator. */
const me = member({
  userId: 'user-1',
  displayName: 'Io',
  isAdmin: true,
  role: 'master',
});

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(rawMember());
  vi.mocked(notifyError).mockClear();
  vi.mocked(notifySuccess).mockClear();
});

describe('MemberManagement', () => {
  it('lists the members with their profile details', () => {
    render([
      { ...me, pronouns: 'lei', bio: 'Due righe.' },
      member({ displayName: 'Narratore', role: 'master' }),
    ]);

    expect(screen.getByText('lei')).toBeInTheDocument();
    expect(screen.getByText('Due righe.')).toBeInTheDocument();
    // Scoped to the row: "Master" is also the role label in that same cell.
    expect(within(rowFor('Narratore')).getByText('Master')).toBeInTheDocument();
  });

  it('marks which row is you', () => {
    render([me]);

    expect(screen.getByText('Tu')).toBeInTheDocument();
  });

  it("changes another member's role", async () => {
    const { user } = render([me, member()]);

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
    const { user } = render([me, member()]);

    await user.click(within(rowFor('Altro')).getByRole('switch'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/members/user-2', {
        method: 'PATCH',
        json: { role: undefined, is_admin: true },
      }),
    );
  });

  it('removes another member without leaving the page', async () => {
    const { onLeft, user } = render([me, member()]);

    await user.click(within(rowFor('Altro')).getByRole('button', { name: 'Rimuovi' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/members/user-2', {
        method: 'DELETE',
      }),
    );
    expect(onLeft).not.toHaveBeenCalled();
  });

  it.each([
    ['Altro', 'Rimuovi'],
    ['Io', 'Esci'],
  ])('shows loading only on %s while removing them', async (name, label) => {
    let finishRemoval!: () => void;
    const removal = new Promise<void>((resolve) => {
      finishRemoval = resolve;
    });
    fetchMock.mockImplementation((_path: string, init?: { method?: string }) =>
      init?.method === 'DELETE' ? removal : Promise.resolve(rawMember()),
    );
    const { user } = render([me, member(), member({ userId: 'user-3', displayName: 'Terzo' })]);
    const selectedButton = within(rowFor(name)).getByRole('button', { name: label });

    await user.click(selectedButton);

    await waitFor(() => expect(selectedButton).toHaveAttribute('data-loading'));
    for (const otherName of ['Io', 'Altro', 'Terzo'].filter((other) => other !== name)) {
      expect(within(rowFor(otherName)).getByRole('button')).not.toHaveAttribute('data-loading');
    }

    finishRemoval();
    await waitFor(() => expect(selectedButton).not.toHaveAttribute('data-loading'));
  });

  // Leaving drops the Room off your own list, so staying on its page would
  // show a 403 on the next refresh.
  it('reports that you left the Room yourself', async () => {
    const { onLeft, user } = render([me, member()]);

    await user.click(within(rowFor('Io')).getByRole('button', { name: 'Esci' }));

    await waitFor(() => expect(onLeft).toHaveBeenCalled());
  });

  // The backend refuses to leave a Room without a Master or Administrator
  // (D-16); the message has to reach the user rather than vanish.
  it('surfaces a rejected change', async () => {
    fetchMock.mockRejectedValue(new Error('A Room must keep at least one Master'));
    const { user } = render([me]);

    await user.click(within(rowFor('Io')).getByRole('switch'));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });

  it('surfaces a rejected role change', async () => {
    fetchMock.mockRejectedValue(new Error('no'));
    const { user } = render([me]);

    await user.click(within(rowFor('Io')).getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Player' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });

  it('surfaces a rejected removal', async () => {
    fetchMock.mockRejectedValue(new Error('no'));
    const { onLeft, user } = render([me]);

    await user.click(within(rowFor('Io')).getByRole('button', { name: 'Esci' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(onLeft).not.toHaveBeenCalled();
  });

  describe('Friends', () => {
    /** Serves the Friends lists, and answers everything else like a member. */
    function serveFriends(friends: unknown) {
      fetchMock.mockImplementation((path: string) =>
        Promise.resolve(path === '/friends' ? friends : rawMember()),
      );
    }

    const others = [
      me,
      member(),
      member({ userId: 'user-3', displayName: 'Terzo' }),
      member({ userId: 'user-4', displayName: 'Quarto' }),
      member({ userId: 'user-5', displayName: 'Quinto' }),
    ];

    it('shows where each other member stands and offers Add as Friend to the rest', async () => {
      serveFriends(
        rawFriends({
          friends: [rawFriend({ user_id: 'user-2' })],
          incoming: [rawFriend({ user_id: 'user-3' })],
          outgoing: [rawFriend({ user_id: 'user-4' })],
        }),
      );
      render(others);

      expect(await within(rowFor('Altro')).findByText('Amico')).toBeInTheDocument();
      expect(within(rowFor('Terzo')).getByText("Ti ha chiesto l'amicizia")).toBeInTheDocument();
      expect(within(rowFor('Quarto')).getByText('Richiesta inviata')).toBeInTheDocument();
      expect(
        within(rowFor('Quinto')).getByRole('button', { name: 'Aggiungi agli amici' }),
      ).toBeInTheDocument();
      // Never to yourself.
      expect(
        within(rowFor('Io')).queryByRole('button', { name: 'Aggiungi agli amici' }),
      ).not.toBeInTheDocument();
    });

    it('sends a friend request to a member and confirms it', async () => {
      serveFriends(rawFriends());
      const { user } = render([me, member()]);

      await user.click(
        await within(rowFor('Altro')).findByRole('button', { name: 'Aggiungi agli amici' }),
      );

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith('/friends/requests', {
          method: 'POST',
          json: { user_id: 'user-2' },
        }),
      );
      await waitFor(() =>
        expect(notifySuccess).toHaveBeenCalledWith('Richiesta di amicizia inviata a Altro.'),
      );
    });

    it('shows loading only on the member being asked', async () => {
      let finish!: (value: unknown) => void;
      const request = new Promise((resolve) => {
        finish = resolve;
      });
      fetchMock.mockImplementation((path: string) => {
        if (path === '/friends') return Promise.resolve(rawFriends());
        if (path === '/friends/requests') return request;
        return Promise.resolve(rawMember());
      });
      const { user } = render([me, member(), member({ userId: 'user-3', displayName: 'Terzo' })]);
      const button = await within(rowFor('Altro')).findByRole('button', {
        name: 'Aggiungi agli amici',
      });

      await user.click(button);

      await waitFor(() => expect(button).toHaveAttribute('data-loading'));
      expect(
        within(rowFor('Terzo')).getByRole('button', { name: 'Aggiungi agli amici' }),
      ).not.toHaveAttribute('data-loading');
      finish(rawFriend({ user_id: 'user-2' }));
      await waitFor(() => expect(button).not.toHaveAttribute('data-loading'));
    });

    it('reports a refused request', async () => {
      fetchMock.mockImplementation((path: string) => {
        if (path === '/friends') return Promise.resolve(rawFriends());
        if (path === '/friends/requests') return Promise.reject(new Error('Already sent'));
        return Promise.resolve(rawMember());
      });
      const { user } = render([me, member()]);

      await user.click(
        await within(rowFor('Altro')).findByRole('button', { name: 'Aggiungi agli amici' }),
      );

      await waitFor(() => expect(notifyError).toHaveBeenCalled());
    });
  });
});
