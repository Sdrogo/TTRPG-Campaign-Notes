import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../utils';
import { MemberMultiSelect } from '../../components/MemberMultiSelect';
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

function render(props: Partial<Parameters<typeof MemberMultiSelect>[0]> = {}) {
  const onChange = vi.fn();
  renderWithProviders(
    <MemberMultiSelect
      members={members}
      value={[]}
      onChange={onChange}
      label="Chi può vedere"
      {...props}
    />,
  );
  return { onChange, user: userEvent.setup() };
}

const field = () => screen.getByRole('combobox', { name: 'Chi può vedere' });

describe('MemberMultiSelect', () => {
  // Other members' emails are never sent (NFR-03): the option is the name;
  // `memberOptionLabel` tells apart members sharing one.
  it('labels each member with their name', async () => {
    const { user } = render();

    await user.click(field());

    expect(screen.getByText('Giocatore')).toBeInTheDocument();
  });

  it('falls back to the email when a member chose no name', async () => {
    const { user } = render({ members: [member({ displayName: null })] });

    await user.click(field());

    expect(screen.getByText('giocatore@example.com')).toBeInTheDocument();
  });

  // Two members with neither name nor email would look identical, so a
  // piece of the user id tells them apart.
  it('disambiguates a member with neither name nor email', async () => {
    const { user } = render({
      members: [member({ displayName: null, email: null, userId: 'abcdef12-3456-7890' })],
    });

    await user.click(field());

    expect(screen.getByText('Utente sconosciuto (abcdef12)')).toBeInTheDocument();
  });

  it('reports the picked user id', async () => {
    const { onChange, user } = render();

    await user.click(field());
    await user.click(screen.getByText('Master'));

    expect(onChange).toHaveBeenCalledWith(['user-2']);
  });

  // The author always sees their own Comment (VR-02), so offering to grant
  // it to them would be meaningless.
  it('leaves out excluded members', async () => {
    const { user } = render({ excludeUserIds: ['user-1'] });

    await user.click(field());

    expect(screen.queryByText('Giocatore')).not.toBeInTheDocument();
    expect(screen.getByText('Master')).toBeInTheDocument();
  });
});
