import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { rawMyRoom, rawRoom } from '../fixtures';
import { renderWithProviders } from '../utils';
import { QuickNavMenu } from '../../components/QuickNavMenu';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue([
    rawMyRoom({ room: rawRoom({ id: 'room-2', name: 'Il Bosco' }) }),
    rawMyRoom(),
    rawMyRoom({ room: rawRoom({ id: 'room-3', name: 'Archivio', status: 'archived' }) }),
  ]);
});

function render(route = '/') {
  renderWithProviders(<QuickNavMenu />, { route });
  return userEvent.setup();
}

describe('QuickNavMenu', () => {
  it('fetches nothing before the first open', () => {
    render();

    expect(screen.getByRole('button', { name: 'Navigazione rapida' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('links Home to the landing page and My Rooms to the Rooms page', async () => {
    const user = render();

    await user.click(screen.getByRole('button', { name: 'Navigazione rapida' }));

    expect(await screen.findByRole('menuitem', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('menuitem', { name: 'Le mie Stanze' })).toHaveAttribute('href', '/rooms');
  });

  // Inline on every screen (product owner, 2026-10-25), no side sub-menu.
  it('lists the Rooms in use alphabetically, inline', async () => {
    const user = render();

    await user.click(screen.getByRole('button', { name: 'Navigazione rapida' }));

    const crypt = await screen.findByRole('menuitem', { name: /La Cripta/ });
    const wood = screen.getByRole('menuitem', { name: /Il Bosco/ });
    expect(wood.compareDocumentPosition(crypt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(crypt).toHaveAttribute('href', '/rooms/room-1/documents');
    expect(screen.queryByRole('menuitem', { name: /Archivio/ })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/rooms');
  });

  it('marks the Room being viewed', async () => {
    const user = render('/rooms/room-2/documents/doc-1');

    await user.click(screen.getByRole('button', { name: 'Navigazione rapida' }));

    expect(await screen.findByRole('menuitem', { name: /Il Bosco/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('menuitem', { name: /La Cripta/ })).not.toHaveAttribute('aria-current');
  });

  it('says so when there is no Room', async () => {
    fetchMock.mockResolvedValue([]);
    const user = render();

    await user.click(screen.getByRole('button', { name: 'Navigazione rapida' }));

    expect(await screen.findByText('Ancora nessuna Stanza')).toBeInTheDocument();
  });
});
