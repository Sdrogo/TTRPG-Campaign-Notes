import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { notifySuccess } from '../../lib/notify';
import { renderWithProviders } from '../utils';
import { RoomTitleActions } from '../../components/RoomTitleActions';

vi.mock('../../lib/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

const onLeft = vi.fn();

function render(isAdmin = false) {
  renderWithProviders(
    <RoomTitleActions roomId="room-1" roomName="La Cripta" isAdmin={isAdmin} currentUserId="me" onLeft={onLeft} />,
  );
  return { user: userEvent.setup() };
}

const toggle = () => screen.getByRole('button', { name: 'Azioni per la Stanza La Cripta' });

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(notifySuccess).mockClear();
  onLeft.mockReset();
});

describe('RoomTitleActions', () => {
  it('starts folded into the "⋮" alone', () => {
    render(true);

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Impostazioni' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invita' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Esci' })).not.toBeInTheDocument();
  });

  it('unfolds setup, invite and leave for an Administrator, and folds them back', async () => {
    const { user } = render(true);

    await user.click(toggle());

    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Impostazioni' })).toHaveAttribute('href', '/rooms/room-1/setup');
    expect(screen.getByRole('button', { name: 'Invita' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Esci' })).toBeInTheDocument();

    await user.click(toggle());
    expect(screen.queryByRole('button', { name: 'Esci' })).not.toBeInTheDocument();
  });

  it('offers a non-Administrator only to leave', async () => {
    const { user } = render(false);

    await user.click(toggle());

    expect(screen.getByRole('button', { name: 'Esci' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Impostazioni' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invita' })).not.toBeInTheDocument();
  });

  it('opens the invite dialog, and closes it', async () => {
    vi.mocked(apiFetch).mockResolvedValue([]);
    const { user } = render(true);

    await user.click(toggle());
    await user.click(screen.getByRole('button', { name: 'Invita' }));

    expect(await screen.findByRole('dialog', { name: 'Invita nella Stanza' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('offers everyone the export of the Room, and closes the dialog again (spec 23)', async () => {
    vi.mocked(apiFetch).mockResolvedValue([]);
    const { user } = render(false);

    await user.click(toggle());
    await user.click(screen.getByRole('button', { name: 'Esporta' }));

    expect(await screen.findByRole('dialog', { name: 'Esporta la Stanza' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('leaves the Room after confirming, then calls onLeft', async () => {
    vi.mocked(apiFetch).mockResolvedValue(undefined);
    const { user } = render(false);

    await user.click(toggle());
    await user.click(screen.getByRole('button', { name: 'Esci' }));
    const dialog = await screen.findByRole('dialog', { name: 'Uscire da "La Cripta"?' });
    await user.click(within(dialog).getByRole('button', { name: 'Esci' }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/rooms/room-1/members/me', { method: 'DELETE' }),
    );
    await waitFor(() => expect(onLeft).toHaveBeenCalledOnce());
    expect(notifySuccess).toHaveBeenCalledWith('Hai lasciato "La Cripta"');
  });
});
