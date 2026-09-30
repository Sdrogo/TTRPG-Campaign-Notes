import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { notifyError } from '../../lib/notify';
import { rawMember } from '../../test/fixtures';
import { renderWithProviders } from '../../test/utils';
import { MemberManagement } from './MemberManagement';
import type { Member } from '../../types/member';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../lib/notify', () => ({
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
});
