import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { rawMap } from '../fixtures';
import { renderWithProviders } from '../utils';
import { RoomIndex } from '../../components/RoomIndex';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

const tags = [
  { id: 'tag-npc', name: 'NPC', category: 'Type' },
  { id: 'tag-pc', name: 'PC', category: 'Type' },
  { id: 'tag-faction', name: 'Fazione', category: 'Faction' },
  { id: 'tag-loose', name: 'Sciolto', category: null },
];

// The Room's Main items, in the order an Administrator chose: PC before NPC.
let mainItems: unknown = [{ tag_ids: ['tag-pc'] }, { tag_ids: ['tag-npc'] }];
let maps: unknown = [];

beforeEach(() => {
  fetchMock.mockReset();
  mainItems = [{ tag_ids: ['tag-pc'] }, { tag_ids: ['tag-npc'] }];
  maps = [];
  fetchMock.mockImplementation((path: string) => {
    if (path === '/rooms/room-1/tags/main') return Promise.resolve(mainItems);
    if (path === '/rooms/room-1/maps') return Promise.resolve(maps);
    return Promise.resolve(tags);
  });
});

function render() {
  const result = renderWithProviders(<RoomIndex roomId="room-1" />);
  return { ...result, user: userEvent.setup() };
}

async function renderOpened() {
  const result = render();
  await result.user.click(screen.getByRole('button', { name: /Apri l.indice della Stanza/ }));
  return result;
}

describe('RoomIndex', () => {
  // Spec 44: a tab on the left edge opens the card; no burger in the header.
  it('opens the card titled "Indice della Stanza" from the tab', async () => {
    const { user } = render();
    expect(screen.queryByText('Indice della Stanza')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Apri l.indice della Stanza/ }));

    expect(await screen.findByText('Indice della Stanza')).toBeInTheDocument();
  });

  it('closes the card on a second click on the tab', async () => {
    const { user } = await renderOpened();
    await screen.findByText('Indice della Stanza');

    await user.click(screen.getByRole('button', { name: /Chiudi l.indice della Stanza/ }));

    await waitFor(() => expect(screen.queryByText('Indice della Stanza')).not.toBeInTheDocument());
  });

  it('groups Tags with Main Tags first, other categories, then uncategorized', async () => {
    await renderOpened();

    expect(await screen.findByText('Tag principali')).toBeInTheDocument();
    expect(screen.getByText('Faction')).toBeInTheDocument();
    expect(screen.getByText('Altri Tag')).toBeInTheDocument();
    expect(screen.getByText('#NPC')).toBeInTheDocument();
    expect(screen.getByText('#PC')).toBeInTheDocument();
    expect(screen.getByText('#Fazione')).toBeInTheDocument();
    expect(screen.getByText('#Sciolto')).toBeInTheDocument();
  });

  // Specs 11, 11_3: the Main items keep the order the Room's Administrators
  // gave them (PC before NPC here), not the alphabetical one.
  it("lists the Main items in the Room's chosen order", async () => {
    await renderOpened();
    await screen.findByText('Tag principali');

    const links = screen.getAllByRole('link').map((link) => link.textContent);
    expect(links.slice(0, 2)).toEqual(['#PC', '#NPC']);
  });

  // Spec 11_3: the index follows the same list as the Documents grouping,
  // combinations included, each linking to the Documents carrying all its Tags.
  it('lists a Tag combination among the Main items, linking to all its Tags', async () => {
    mainItems = [{ tag_ids: ['tag-npc'] }, { tag_ids: ['tag-npc', 'tag-faction'] }];
    await renderOpened();

    const link = await screen.findByText('#NPC + #Fazione');
    expect(link).toHaveAttribute('href', '/rooms/room-1/documents?tag=tag-npc&tag=tag-faction');
    const links = screen.getAllByRole('link').map((a) => a.textContent);
    expect(links.slice(0, 2)).toEqual(['#NPC', '#NPC + #Fazione']);
  });

  it('keeps a Tag that is only in a combination under its category', async () => {
    mainItems = [{ tag_ids: ['tag-npc', 'tag-faction'] }];
    await renderOpened();

    await screen.findByText('#NPC + #Fazione');
    // Fazione is not a single Main item, so it is still listed under Faction.
    expect(screen.getByText('Faction')).toBeInTheDocument();
    expect(screen.getByText('#Fazione')).toBeInTheDocument();
  });

  it('lists every Tag by category when the Room has no Main items', async () => {
    mainItems = [];
    await renderOpened();

    expect(await screen.findByText('#PC')).toBeInTheDocument();
    expect(screen.queryByText('Tag principali')).not.toBeInTheDocument();
  });

  // Spec 11_3: saving on the setup page writes the same cached list the index
  // reads, so the index follows without a reload.
  it('updates as soon as the Main items in the cache change', async () => {
    const { queryClient } = await renderOpened();
    await screen.findByText('Tag principali');

    act(() => {
      queryClient.setQueryData(
        ['rooms', 'room-1', 'main-items'],
        [{ tagIds: ['tag-faction', 'tag-loose'] }],
      );
    });

    expect(await screen.findByText('#Fazione + #Sciolto')).toBeInTheDocument();
  });

  it('links each Tag to the Documents list filtered by it', async () => {
    await renderOpened();

    expect(await screen.findByText('#NPC')).toHaveAttribute(
      'href',
      '/rooms/room-1/documents?tag=tag-npc',
    );
  });

  it('closes the card when a Tag is clicked', async () => {
    const { user } = await renderOpened();

    await user.click(await screen.findByText('#NPC'));

    await waitFor(() => expect(screen.queryByText('Indice della Stanza')).not.toBeInTheDocument());
  });

  it('says so when the Room has no Tags', async () => {
    fetchMock.mockResolvedValue([]);
    await renderOpened();

    expect(await screen.findByText('Nessun Tag in questa Stanza.')).toBeInTheDocument();
  });

  it('does not say there are no Tags while they are loading', async () => {
    fetchMock.mockImplementation((path: string) =>
      path === '/rooms/room-1/maps' ? Promise.resolve([]) : new Promise(() => {}),
    );
    await renderOpened();

    await screen.findByText('Tutte le mappe');
    expect(screen.queryByText('Nessun Tag in questa Stanza.')).not.toBeInTheDocument();
  });

  it('does not say there are no Tags when they fail to load, and still lists the maps', async () => {
    fetchMock.mockImplementation((path: string) =>
      path === '/rooms/room-1/maps' ? Promise.resolve([rawMap()]) : Promise.reject(new Error('boom')),
    );
    await renderOpened();

    expect(await screen.findByText('La Corte')).toBeInTheDocument();
    expect(screen.queryByText('Nessun Tag in questa Stanza.')).not.toBeInTheDocument();
  });

  // Spec 44 Decision 5: the maps close the card, alphabetical, after a link
  // to the Maps page.
  it("lists the Room's maps alphabetically after a link to the Maps page", async () => {
    maps = [
      rawMap({ id: 'map-2', name: 'Shibuya di notte', kind: 'geographic' }),
      rawMap({ id: 'map-1', name: 'La Corte' }),
    ];
    await renderOpened();

    expect(await screen.findByText('La Corte')).toHaveAttribute('href', '/rooms/room-1/maps/map-1');
    expect(screen.getByText('Shibuya di notte')).toHaveAttribute('href', '/rooms/room-1/maps/map-2');
    expect(screen.getByText('Mappe')).toBeInTheDocument();
    const links = screen.getAllByRole('link').map((a) => a.textContent);
    expect(links.slice(-3)).toEqual(['Tutte le mappe', 'La Corte', 'Shibuya di notte']);
  });

  it('offers only the Maps page link when the Room has no map', async () => {
    await renderOpened();

    expect(await screen.findByText('Tutte le mappe')).toHaveAttribute('href', '/rooms/room-1/maps');
    await screen.findByText('#NPC');
    expect(screen.getAllByRole('link').at(-1)).toHaveTextContent('Tutte le mappe');
  });

  it('closes the card when a map is clicked', async () => {
    maps = [rawMap()];
    const { user } = await renderOpened();

    await user.click(await screen.findByText('La Corte'));

    await waitFor(() => expect(screen.queryByText('Indice della Stanza')).not.toBeInTheDocument());
  });

  it('fetches nothing before it is opened', () => {
    render();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
