import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { rawRoom } from '../test/fixtures';
import { renderWithProviders } from '../test/utils';
import { CreateRoomModal } from './CreateRoomModal';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

function render(opened = true) {
  const onClose = vi.fn();
  renderWithProviders(<CreateRoomModal opened={opened} onClose={onClose} />);
  return { onClose, user: userEvent.setup() };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('CreateRoomModal', () => {
  it('shows nothing while closed', () => {
    render(false);

    expect(screen.queryByRole('textbox', { name: /Nome/ })).not.toBeInTheDocument();
  });

  it('cannot submit without a name', () => {
    render();

    expect(screen.getByRole('button', { name: 'Crea Stanza' })).toBeDisabled();
  });

  // A name of only spaces is not a name.
  it('cannot submit a whitespace-only name', async () => {
    const { user } = render();

    await user.type(screen.getByRole('textbox', { name: /Nome/ }), '   ');

    expect(screen.getByRole('button', { name: 'Crea Stanza' })).toBeDisabled();
  });

  it('creates the Room with its game system', async () => {
    fetchMock.mockResolvedValue(rawRoom());
    const { user } = render();

    await user.type(screen.getByRole('textbox', { name: /Nome/ }), 'La Cripta');
    await user.type(screen.getByRole('textbox', { name: 'Sistema di gioco' }), 'D&D 5e');
    await user.click(screen.getByRole('button', { name: 'Crea Stanza' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms', {
        method: 'POST',
        json: { name: 'La Cripta', game_system: 'D&D 5e' },
      }),
    );
  });

  it('closes once the Room is created', async () => {
    fetchMock.mockResolvedValue(rawRoom());
    const { onClose, user } = render();

    await user.type(screen.getByRole('textbox', { name: /Nome/ }), 'La Cripta');
    await user.click(screen.getByRole('button', { name: 'Crea Stanza' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  // The modal stays open on failure so the typed name isn't lost.
  it('reports a failure and stays open', async () => {
    fetchMock.mockRejectedValue(new Error('Nome già in uso'));
    const { onClose, user } = render();

    await user.type(screen.getByRole('textbox', { name: /Nome/ }), 'La Cripta');
    await user.click(screen.getByRole('button', { name: 'Crea Stanza' }));

    await waitFor(() => expect(screen.getByText(/Nome già in uso/)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: /Nome/ })).toHaveValue('La Cripta');
  });

  it('clears the form when dismissed', async () => {
    const { onClose, user } = render();
    await user.type(screen.getByRole('textbox', { name: /Nome/ }), 'La Cripta');

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: /Nome/ })).toHaveValue('');
  });
});
