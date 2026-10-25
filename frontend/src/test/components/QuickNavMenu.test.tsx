import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { SPLIT_QUERY } from '../../hooks/useSideDocument';
import { rawMyRoom, rawRoom } from '../fixtures';
import { matchMediaQueries } from '../media';
import { renderWithProviders } from '../utils';
import { QuickNavMenu } from '../../components/QuickNavMenu';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);
let restoreMedia: (() => void) | null = null;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue([
    rawMyRoom({ room: rawRoom({ id: 'room-2', name: 'Il Bosco' }) }),
    rawMyRoom(),
    rawMyRoom({ room: rawRoom({ id: 'room-3', name: 'Archivio', status: 'archived' }) }),
  ]);
});

afterEach(() => {
  restoreMedia?.();
  restoreMedia = null;
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

  // On a phone there is no room for a side sub-menu: the Rooms are inline.
  it('lists the Rooms in use alphabetically, inline on a phone', async () => {
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

  it('opens the Rooms in a sub-menu on a wider screen', async () => {
    restoreMedia = matchMediaQueries([SPLIT_QUERY]);
    const user = render();

    await user.click(screen.getByRole('button', { name: 'Navigazione rapida' }));
    const sub = await screen.findByRole('menuitem', { name: 'Stanze' });
    expect(screen.queryByRole('menuitem', { name: /La Cripta/ })).not.toBeInTheDocument();

    await user.click(sub);

    const dropdown = (await screen.findByRole('menuitem', { name: /La Cripta/ })).closest('[role="menu"]');
    expect(within(dropdown as HTMLElement).getByRole('menuitem', { name: /Il Bosco/ })).toBeInTheDocument();
  });
});
