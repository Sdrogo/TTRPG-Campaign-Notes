import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { renderWithProviders } from '../test/utils';
import { GlossaryIndexDrawer } from './GlossaryIndexDrawer';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

const tags = [
  { id: 'tag-npc', name: 'NPC', category: 'Type' },
  { id: 'tag-pc', name: 'PC', category: 'Type' },
  { id: 'tag-faction', name: 'Fazione', category: 'Faction' },
  { id: 'tag-loose', name: 'Sciolto', category: null },
];

// The Room's Main items, in the order an Administrator chose: PC before NPC.
let mainItems: unknown = [{ tag_ids: ['tag-pc'] }, { tag_ids: ['tag-npc'] }];

beforeEach(() => {
  fetchMock.mockReset();
  mainItems = [{ tag_ids: ['tag-pc'] }, { tag_ids: ['tag-npc'] }];
  fetchMock.mockImplementation((path: string) =>
    Promise.resolve(path === '/rooms/room-1/tags/main' ? mainItems : tags),
  );
});

function render(opened = true) {
  const onClose = vi.fn();
  renderWithProviders(<GlossaryIndexDrawer roomId="room-1" opened={opened} onClose={onClose} />);
  return { onClose, user: userEvent.setup() };
}

describe('GlossaryIndexDrawer', () => {
  it('titles itself "Indice dei Tag"', async () => {
    render();

    expect(await screen.findByRole('heading', { name: 'Indice dei Tag' })).toBeInTheDocument();
  });

  it('groups Tags with Main Tags first, other categories, then uncategorized', async () => {
    render();

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
    render();
    await screen.findByText('Tag principali');

    const links = screen.getAllByRole('link').map((link) => link.textContent);
    expect(links.slice(0, 2)).toEqual(['#PC', '#NPC']);
  });

  // Spec 11_3: the index follows the same list as the Documents grouping,
  // combinations included, each linking to the Documents carrying all its Tags.
  it('lists a Tag combination among the Main items, linking to all its Tags', async () => {
    mainItems = [{ tag_ids: ['tag-npc'] }, { tag_ids: ['tag-npc', 'tag-faction'] }];
    render();

    const link = await screen.findByText('#NPC + #Fazione');
    expect(link).toHaveAttribute('href', '/rooms/room-1/documents?tag=tag-npc&tag=tag-faction');
    const links = screen.getAllByRole('link').map((a) => a.textContent);
    expect(links.slice(0, 2)).toEqual(['#NPC', '#NPC + #Fazione']);
  });

  it('keeps a Tag that is only in a combination under its category', async () => {
    mainItems = [{ tag_ids: ['tag-npc', 'tag-faction'] }];
    render();

    await screen.findByText('#NPC + #Fazione');
    // Fazione is not a single Main item, so it is still listed under Faction.
    expect(screen.getByText('Faction')).toBeInTheDocument();
    expect(screen.getByText('#Fazione')).toBeInTheDocument();
  });

  it('lists every Tag by category when the Room has no Main items', async () => {
    mainItems = [];
    render();

    expect(await screen.findByText('#PC')).toBeInTheDocument();
    expect(screen.queryByText('Tag principali')).not.toBeInTheDocument();
  });

  // Spec 11_3: saving on the setup page writes the same cached list the index
  // reads, so the index follows without a reload.
  it('updates as soon as the Main items in the cache change', async () => {
    const { queryClient } = renderWithProviders(
      <GlossaryIndexDrawer roomId="room-1" opened={true} onClose={vi.fn()} />,
    );
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
    render();

    expect(await screen.findByText('#NPC')).toHaveAttribute(
      'href',
      '/rooms/room-1/documents?tag=tag-npc',
    );
  });

  it('closes the drawer when a Tag is clicked', async () => {
    const { onClose, user } = render();

    await user.click(await screen.findByText('#NPC'));

    expect(onClose).toHaveBeenCalled();
  });

  it('says so when the Room has no Tags', async () => {
    fetchMock.mockResolvedValue([]);
    render();

    expect(await screen.findByText('Nessun Tag in questa Stanza.')).toBeInTheDocument();
  });

  it('does not fetch Tags before it is opened', () => {
    render(false);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
