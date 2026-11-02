import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { renderWithProviders } from '../utils';
import { RoomIndex, type RoomIndexContext } from '../../components/RoomIndex';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

const section = (id: string, kind: string, position: number, title: string | null = null) => ({
  id,
  kind,
  position,
  title,
  description: '',
  image_url: null,
  blocks: [],
  can_edit: false,
});

const sections = [
  section('s-docs', 'page_documents', 0),
  section('s-tokyo', 'custom', 1, 'Tokyo'),
  section('s-maps', 'page_maps', 2, 'Atlante'),
  section('s-zero', 'page_session_zero', 3),
];

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => Promise.resolve(sections));
});

async function renderOpened(context: RoomIndexContext = {}) {
  const user = userEvent.setup();
  renderWithProviders(<RoomIndex roomId="room-1" {...context} />);
  await user.click(screen.getByRole('button', { name: /Apri l.indice della Stanza/ }));
  return user;
}

describe('RoomIndex', () => {
  it('fetches nothing before it first opens', () => {
    renderWithProviders(<RoomIndex roomId="room-1" />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Spec 55 Decision 10: the Room's home, then every Section in the landing's order.
  it('lists the Room home, then the Sections in order with their default names', async () => {
    await renderOpened();

    expect(await screen.findByRole('link', { name: 'Home della Stanza' })).toHaveAttribute('href', '/rooms/room-1');
    const links = screen.getAllByRole('link').slice(1);
    expect(links.map((link) => link.textContent)).toEqual(['Documenti', 'Tokyo', 'Atlante', 'Sessione 0']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/rooms/room-1/documents',
      '/rooms/room-1/sections/s-tokyo',
      '/rooms/room-1/maps',
      '/rooms/room-1/session-zero',
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/sections');
  });

  it('marks the Section on screen, by its id or by the page a page card opens', async () => {
    await renderOpened({ current: 'page_maps' });

    expect(await screen.findByRole('link', { name: 'Atlante' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Tokyo' })).not.toHaveAttribute('aria-current');
  });

  it("lists a custom Section's blocks with their sub-sections and scrolls to one", async () => {
    const block = document.createElement('div');
    block.id = 'block-b-1';
    block.scrollIntoView = vi.fn();
    document.body.appendChild(block);
    const user = await renderOpened({
      current: 's-tokyo',
      detail: { title: 'Tokyo', entries: [{ id: 'b-1', label: 'PNG', children: ['#Yakuza'] }] },
    });

    expect(await screen.findByText('#Yakuza')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'PNG' }));

    expect(block.scrollIntoView).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Indice della Stanza')).not.toBeInTheDocument());
    block.remove();
  });

  it('closes the card when a Section is clicked', async () => {
    const user = await renderOpened();

    await user.click(await screen.findByRole('link', { name: 'Tokyo' }));

    await waitFor(() => expect(screen.queryByText('Indice della Stanza')).not.toBeInTheDocument());
  });

  it('lists no Section when they fail to load', async () => {
    fetchMock.mockRejectedValue(new Error('no'));
    await renderOpened();

    expect(await screen.findByRole('link', { name: 'Home della Stanza' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Documenti' })).not.toBeInTheDocument());
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});
