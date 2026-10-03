import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../utils';
import { DocumentPlayer } from '../../components/DocumentPlayer';
import type { Member } from '../../types/member';

function member(overrides: Partial<Member> = {}): Member {
  return {
    userId: 'user-1',
    role: 'player',
    isAdmin: false,
    email: 'giocatore@example.com',
    displayName: 'Giocatore',
    pronouns: null,
    bio: null,
    avatarUrl: null,
    ...overrides,
  };
}

const members = [
  member(),
  member({ userId: 'user-2', displayName: 'Master', email: 'master@example.com' }),
];

function render(props: Partial<Parameters<typeof DocumentPlayer>[0]> = {}) {
  const onSet = vi.fn();
  const onUnlink = vi.fn();
  renderWithProviders(
    <DocumentPlayer
      playedBy="user-1"
      members={members}
      canManage
      onSet={onSet}
      onUnlink={onUnlink}
      {...props}
    />,
  );
  return { onSet, onUnlink, user: userEvent.setup() };
}

const picker = () => screen.getByRole('combobox', { name: 'Scegli il giocatore' });
// The picker sits in a popover behind a "+", not always open.
const openPicker = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Scegli il giocatore' }));

describe('DocumentPlayer', () => {
  it('names the player', () => {
    render({ canManage: false });

    expect(screen.getByText('Interpretato da')).toBeInTheDocument();
    expect(screen.getByText('Giocatore')).toBeInTheDocument();
    // D-12: a reader who isn't an Owner sees the player and nothing else.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Scollega/ })).not.toBeInTheDocument();
  });

  it('shows nothing to a reader when nobody plays the Document', () => {
    render({ playedBy: null, canManage: false });

    expect(screen.queryByText('Interpretato da')).not.toBeInTheDocument();
  });

  it('lets an Owner pick a player for a Document nobody plays', async () => {
    const { user } = render({ playedBy: null });

    expect(screen.getByText('Interpretato da')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await openPicker(user);
    expect(picker()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Imposta giocatore' })).toBeDisabled();
  });

  it('unlinks the player', async () => {
    const { onUnlink, user } = render();

    await user.click(screen.getByRole('button', { name: 'Scollega Giocatore' }));

    expect(onUnlink).toHaveBeenCalled();
  });

  it('only offers members other than the current player', async () => {
    const { user } = render();

    await openPicker(user);
    await user.click(picker());

    expect(screen.getByRole('option', { name: 'Master' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Giocatore' })).not.toBeInTheDocument();
  });

  // Decision 3 of spec 17: also making the player an Owner is the default.
  it('also makes the player an Owner by default, then clears the picker', async () => {
    const { onSet, user } = render({ playedBy: null });

    await openPicker(user);
    expect(screen.getByRole('checkbox', { name: 'Rendilo anche Owner' })).toBeChecked();
    await user.click(picker());
    await user.click(screen.getByText('Master'));
    await user.click(screen.getByRole('button', { name: 'Imposta giocatore' }));

    expect(onSet).toHaveBeenCalledWith('user-2', true);
    await openPicker(user);
    expect(screen.getByRole('button', { name: 'Imposta giocatore' })).toBeDisabled();
  });

  it('can link a player without making them an Owner', async () => {
    const { onSet, user } = render({ playedBy: null });

    await openPicker(user);
    await user.click(screen.getByRole('checkbox', { name: 'Rendilo anche Owner' }));
    await user.click(picker());
    await user.click(screen.getByText('Giocatore'));
    await user.click(screen.getByRole('button', { name: 'Imposta giocatore' }));

    expect(onSet).toHaveBeenCalledWith('user-1', false);
  });

  it('handles a player who is no longer a member', () => {
    render({ playedBy: 'user-gone', canManage: false });

    expect(screen.getByText('Utente sconosciuto')).toBeInTheDocument();
  });
});
