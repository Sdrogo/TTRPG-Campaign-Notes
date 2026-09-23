import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { RoleTag } from './RoleTag';

describe('RoleTag', () => {
  it('names the Master role', () => {
    renderWithProviders(<RoleTag role="master" isAdmin={false} />);

    expect(screen.getByText('Master')).toBeInTheDocument();
  });

  it('names the Player role', () => {
    renderWithProviders(<RoleTag role="player" isAdmin={false} />);

    expect(screen.getByText('Player')).toBeInTheDocument();
  });

  // Administrator stacks on top of the role (D-11); it's a second badge,
  // not a third role.
  it('adds an Admin badge alongside the role when the member is one', () => {
    renderWithProviders(<RoleTag role="player" isAdmin />);

    expect(screen.getByText('Player')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('shows no Admin badge for an ordinary member', () => {
    renderWithProviders(<RoleTag role="player" isAdmin={false} />);

    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('shows both badges for an Administrator Master', () => {
    renderWithProviders(<RoleTag role="master" isAdmin />);

    expect(screen.getByText('Master')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });
});
