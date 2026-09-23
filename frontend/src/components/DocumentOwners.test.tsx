import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { DocumentOwners } from './DocumentOwners';
import type { Member } from '../types/member';

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

function render(props: Partial<Parameters<typeof DocumentOwners>[0]> = {}) {
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  renderWithProviders(
    <DocumentOwners
      ownerIds={['user-1']}
      members={members}
      canManage
      onAdd={onAdd}
      onRemove={onRemove}
      {...props}
    />,
  );
  return { onAdd, onRemove, user: userEvent.setup() };
}

describe('DocumentOwners', () => {
  it('names the current Owners', () => {
    render();

    expect(screen.getByText('Giocatore')).toBeInTheDocument();
  });

  it('removes an Owner', async () => {
    const { onRemove, user } = render();

    await user.click(screen.getByRole('button', { name: 'Rimuovi Owner Giocatore' }));

    expect(onRemove).toHaveBeenCalledWith('user-1');
  });

  // D-12: only an Owner or the Master may reassign Ownership. A viewer who
  // can't must see the Owners but be offered nothing.
  it('offers no controls to a viewer who may not manage Owners', () => {
    render({ canManage: false });

    expect(screen.getByText('Giocatore')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rimuovi Owner/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('only offers members who are not already Owners', async () => {
    const { user } = render();

    await user.click(screen.getByRole('combobox'));

    expect(screen.getByText('Master (master@example.com)')).toBeInTheDocument();
    expect(screen.queryByText('Giocatore (giocatore@example.com)')).not.toBeInTheDocument();
  });

  it('cannot submit before someone is picked', () => {
    render();

    expect(screen.getByRole('button', { name: 'Aggiungi' })).toBeDisabled();
  });

  it('adds the picked member as an Owner', async () => {
    const { onAdd, user } = render();

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByText('Master (master@example.com)'));
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));

    expect(onAdd).toHaveBeenCalledWith('user-2');
  });

  // Otherwise the next click would silently add the same person again.
  it('clears the picker after adding', async () => {
    const { user } = render();
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByText('Master (master@example.com)'));

    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));

    expect(screen.getByRole('button', { name: 'Aggiungi' })).toBeDisabled();
  });

  it('handles an Owner who is no longer a member', () => {
    render({ ownerIds: ['user-gone'] });

    expect(screen.getByText('Utente sconosciuto')).toBeInTheDocument();
  });
});
