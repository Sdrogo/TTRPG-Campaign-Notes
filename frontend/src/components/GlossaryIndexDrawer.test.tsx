import { screen } from '@testing-library/react';
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

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(tags);
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
