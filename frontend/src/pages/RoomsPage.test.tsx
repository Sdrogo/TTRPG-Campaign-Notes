import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { rawMyRoom, rawRoom } from '../test/fixtures';
import { renderWithProviders } from '../test/utils';
import { RoomsPage } from './RoomsPage';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

function render() {
  renderWithProviders(<RoomsPage />);
  return { user: userEvent.setup() };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('RoomsPage', () => {
  it('lists the Rooms the user belongs to', async () => {
    fetchMock.mockResolvedValue([
      rawMyRoom(),
      rawMyRoom({ room: rawRoom({ id: 'room-2', name: 'Il Bosco' }) }),
    ]);
    render();

    expect(await screen.findByText('La Cripta')).toBeInTheDocument();
    expect(screen.getByText('Il Bosco')).toBeInTheDocument();
  });

  it('invites the first Room when there are none', async () => {
    fetchMock.mockResolvedValue([]);
    render();

    expect(await screen.findByText(/Nessuna Stanza ancora/)).toBeInTheDocument();
  });

  it('reports a failed load', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render();

    expect(await screen.findByText('Errore nel caricamento delle Stanze.')).toBeInTheDocument();
  });

  it('shows a loader while the Rooms are on their way', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderWithProviders(<RoomsPage />);

    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
  });

  it('opens the create-Room modal', async () => {
    fetchMock.mockResolvedValue([]);
    const { user } = render();
    await screen.findByText(/Nessuna Stanza ancora/);

    await user.click(screen.getByRole('button', { name: /Crea Stanza/ }));

    expect(screen.getByRole('textbox', { name: /Nome/ })).toBeInTheDocument();
  });

  // Creating a Room invalidates the list, so the new one appears without a
  // manual refresh.
  it('shows a Room created from the modal', async () => {
    fetchMock.mockResolvedValue([]);
    const { user } = render();
    await screen.findByText(/Nessuna Stanza ancora/);
    await user.click(screen.getByRole('button', { name: /Crea Stanza/ }));

    fetchMock.mockImplementation((_path: string, init?: { method?: string }) =>
      init?.method === 'POST'
        ? Promise.resolve(rawRoom())
        : Promise.resolve([rawMyRoom()]),
    );
    await user.type(screen.getByRole('textbox', { name: /Nome/ }), 'La Cripta');
    // The page header button opens the modal and the modal's submit share a
    // label, so reach for the one inside the dialog.
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Crea Stanza' }));

    await waitFor(() => expect(screen.getByText('La Cripta')).toBeInTheDocument());
  });
});
