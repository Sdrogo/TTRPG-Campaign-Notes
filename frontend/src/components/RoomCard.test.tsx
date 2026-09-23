import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { renderWithProviders } from '../test/utils';
import { RoomCard } from './RoomCard';
import type { MyRoom } from '../types/room';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));

function myRoom(overrides: Partial<MyRoom> = {}): MyRoom {
  return {
    room: {
      id: 'room-1',
      name: 'La Cripta',
      gameSystem: 'D&D 5e',
      status: 'active',
      playersCanCreateDocuments: true,
    },
    role: 'player',
    isAdmin: false,
    ...overrides,
  };
}

function render(overrides: Partial<MyRoom> = {}) {
  renderWithProviders(<RoomCard myRoom={myRoom(overrides)} />);
  return { user: userEvent.setup() };
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
});

describe('RoomCard', () => {
  it('shows the Room name, system and role', () => {
    render();

    expect(screen.getByText('La Cripta')).toBeInTheDocument();
    expect(screen.getByText('D&D 5e')).toBeInTheDocument();
    expect(screen.getByText('Player')).toBeInTheDocument();
  });

  it('omits the system line when the Room has none', () => {
    render({ room: { ...myRoom().room, gameSystem: null } });

    expect(screen.queryByText('D&D 5e')).not.toBeInTheDocument();
  });

  it('links to the Documents and members pages', () => {
    render();

    expect(screen.getByRole('link', { name: /Documenti/ })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents',
    );
    expect(screen.getByRole('link', { name: /Membri/ })).toHaveAttribute(
      'href',
      '/rooms/room-1/members',
    );
  });

  // Only an Administrator can invite (the backend rejects anyone else), so
  // the button is theirs alone.
  it('offers no invite to an ordinary member', () => {
    render();

    expect(screen.queryByRole('button', { name: /Invita/ })).not.toBeInTheDocument();
  });

  it('offers the invite to an Administrator', () => {
    render({ isAdmin: true });

    expect(screen.getByRole('button', { name: /Invita/ })).toBeInTheDocument();
  });

  it('opens the invite modal', async () => {
    const { user } = render({ isAdmin: true });

    await user.click(screen.getByRole('button', { name: /Invita/ }));

    expect(screen.getByRole('button', { name: 'Genera invito' })).toBeInTheDocument();
  });
});
