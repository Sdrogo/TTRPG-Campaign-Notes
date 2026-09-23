import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { renderWithProviders } from '../test/utils';
import { InviteModal } from './InviteModal';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

function render() {
  const onClose = vi.fn();
  renderWithProviders(<InviteModal opened onClose={onClose} roomId="room-1" />);
  return { onClose, user: userEvent.setup() };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('InviteModal', () => {
  it('proposes the Player role by default', () => {
    render();

    expect(screen.getByRole('combobox', { name: 'Ruolo proposto' })).toHaveValue('Player');
  });

  it('creates an invitation for the chosen role', async () => {
    fetchMock.mockResolvedValue({ code: 'ABC123', role: 'master', expires_at: null });
    const { user } = render();

    await user.click(screen.getByRole('combobox', { name: 'Ruolo proposto' }));
    await user.click(screen.getByText('Master'));
    await user.click(screen.getByRole('button', { name: 'Genera invito' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/invitations', {
        method: 'POST',
        json: { role: 'master' },
      }),
    );
  });

  // The code alone isn't usable; the invitee needs the whole link.
  it('shows the full invite link once generated', async () => {
    fetchMock.mockResolvedValue({ code: 'ABC123', role: 'player', expires_at: null });
    const { user } = render();

    await user.click(screen.getByRole('button', { name: 'Genera invito' }));

    await waitFor(() =>
      expect(screen.getByDisplayValue(`${window.location.origin}/invite/ABC123`)).toBeInTheDocument(),
    );
  });

  // One invitation per opening: changing the role afterwards would show a
  // link that doesn't match the role on screen.
  it('locks the role and hides the generate button afterwards', async () => {
    fetchMock.mockResolvedValue({ code: 'ABC123', role: 'player', expires_at: null });
    const { user } = render();

    await user.click(screen.getByRole('button', { name: 'Genera invito' }));

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Ruolo proposto' })).toBeDisabled(),
    );
    expect(screen.queryByRole('button', { name: 'Genera invito' })).not.toBeInTheDocument();
  });

  it('shows the link read-only so it cannot be edited before copying', async () => {
    fetchMock.mockResolvedValue({ code: 'ABC123', role: 'player', expires_at: null });
    const { user } = render();

    await user.click(screen.getByRole('button', { name: 'Genera invito' }));

    await waitFor(() =>
      expect(screen.getByDisplayValue(/ABC123/)).toHaveAttribute('readonly'),
    );
  });

  // The generated link belongs to the session that made it; reopening must
  // not show a stale one.
  it('forgets the generated link when closed', async () => {
    fetchMock.mockResolvedValue({ code: 'ABC123', role: 'player', expires_at: null });
    const { onClose, user } = render();
    await user.click(screen.getByRole('button', { name: 'Genera invito' }));
    await screen.findByDisplayValue(/ABC123/);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByDisplayValue(/ABC123/)).not.toBeInTheDocument());
  });

  it('reports a failure', async () => {
    fetchMock.mockRejectedValue(new Error('Only an Administrator can invite'));
    const { user } = render();

    await user.click(screen.getByRole('button', { name: 'Genera invito' }));

    await waitFor(() =>
      expect(screen.getByText(/Only an Administrator can invite/)).toBeInTheDocument(),
    );
  });
});
