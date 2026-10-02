import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/apiClient';
import { notifyError, notifySuccess } from '../../../lib/notify';
import { rawDirectInvitation, rawRoom } from '../../fixtures';
import { renderWithProviders } from '../../utils';
import { RoomInvitationsSection } from '../../../components/account/RoomInvitationsSection';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

function render() {
  renderWithProviders(<RoomInvitationsSection />);
  return { user: userEvent.setup() };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(notifyError).mockClear();
  vi.mocked(notifySuccess).mockClear();
});

describe('RoomInvitationsSection', () => {
  it('renders nothing while there are no invitations', async () => {
    fetchMock.mockResolvedValue([]);
    render();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/invitations/mine'));
    expect(screen.queryByText('Inviti alle Stanze')).not.toBeInTheDocument();
  });

  it('names the Room, who invited and the proposed role', async () => {
    fetchMock.mockResolvedValue([rawDirectInvitation({ role: 'master' })]);
    render();

    expect(await screen.findByText('Inviti alle Stanze')).toBeInTheDocument();
    expect(screen.getByText('Barovia')).toBeInTheDocument();
    expect(screen.getByText(/Altro ti invita come Master/)).toBeInTheDocument();
  });

  it('accepts an invitation and confirms the Room joined', async () => {
    fetchMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/invitations/mine'
          ? [rawDirectInvitation()]
          : rawRoom({ id: 'room-2', name: 'Barovia' }),
      ),
    );
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Accetta' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/invitations/DIRECT1/accept', { method: 'POST' }),
    );
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Ti sei unito a "Barovia".'));
  });

  it('reports a failed acceptance', async () => {
    fetchMock.mockImplementation((path: string) =>
      path === '/invitations/mine'
        ? Promise.resolve([rawDirectInvitation()])
        : Promise.reject(new Error('expired')),
    );
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Accetta' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });

  it('declines an invitation', async () => {
    fetchMock.mockImplementation((path: string) =>
      Promise.resolve(path === '/invitations/mine' ? [rawDirectInvitation()] : undefined),
    );
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Rifiuta' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/invitations/DIRECT1/decline', { method: 'POST' }),
    );
  });

  it('shows loading only on the invitation being answered', async () => {
    const pending = new Promise(() => {});
    fetchMock.mockImplementation((path: string) =>
      path === '/invitations/mine'
        ? Promise.resolve([
            rawDirectInvitation(),
            rawDirectInvitation({ code: 'DIRECT2', room: rawRoom({ id: 'room-3', name: 'Phandalin' }) }),
          ])
        : pending,
    );
    const { user } = render();
    await screen.findByText('Phandalin');
    const [first, second] = screen.getAllByRole('button', { name: 'Accetta' });

    await user.click(first);

    await waitFor(() => expect(first).toHaveAttribute('data-loading'));
    expect(second).not.toHaveAttribute('data-loading');
  });

  it('shows loading only on the invitation being declined', async () => {
    const pending = new Promise(() => {});
    fetchMock.mockImplementation((path: string) =>
      path === '/invitations/mine'
        ? Promise.resolve([
            rawDirectInvitation(),
            rawDirectInvitation({ code: 'DIRECT2', room: rawRoom({ id: 'room-3', name: 'Phandalin' }) }),
          ])
        : pending,
    );
    const { user } = render();
    await screen.findByText('Phandalin');
    const [first, second] = screen.getAllByRole('button', { name: 'Rifiuta' });

    await user.click(first);

    await waitFor(() => expect(first).toHaveAttribute('data-loading'));
    expect(second).not.toHaveAttribute('data-loading');
  });
});
