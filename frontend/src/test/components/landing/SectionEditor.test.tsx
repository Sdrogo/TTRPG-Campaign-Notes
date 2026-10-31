import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import type { ReactElement } from 'react';
import type { InitialEntry } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SectionEditor } from '../../../components/landing/SectionEditor';
import type { BlockSources } from '../../../components/landing/blockItems';
import { apiFetch } from '../../../lib/apiClient';
import { rawBlock, rawSection } from '../../fixtures';
import { doc, overview, section, tag } from '../../landingFixtures';
import { renderWithProviders } from '../../utils';
import { theme } from '../../../theme/theme';

vi.mock('../../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../../../components/landing/Sortable', () => import('./sortableMock'));

const fetchMock = vi.mocked(apiFetch);
const tags = [tag('t1', 'Tokyo'), tag('t2', 'PNG'), tag('t3', 'Yakuza')];
const sources: BlockSources = {
  tags,
  documents: [doc('a', 'Aiko', ['t1', 't2']), doc('b', 'Bunta', ['t1', 't3']), doc('c', 'Chie', ['t1'])],
  maps: [],
  overview: overview(),
};

const documentsBlock = rawBlock({ id: 'block-1', tag_ids: ['t1'], groups: [['t2'], ['gone'], ['t3']] });
const zeroBlock = rawBlock({ id: 'block-2', kind: 'session_zero', tag_ids: [], features: ['retro', 'stars_wishes', 'polls'] });
const mapsBlock = rawBlock({ id: 'block-3', kind: 'maps', tag_ids: [] });
const plainBlock = rawBlock({ id: 'block-4', tag_ids: ['t1'] });

const wire = (raw: Record<string, unknown>) => {
  const { id: _id, position: _position, ...rest } = raw;
  return rest;
};

function editor(blocks: Record<string, unknown>[] = [], route: InitialEntry = '/rooms/room-1/sections/section-1') {
  return renderWithProviders(<SectionEditor roomId="room-1" section={section({ blocks })} sources={sources} />, { route });
}

function savedBlocks() {
  const [path, init] = fetchMock.mock.calls.filter(([path]) => String(path).endsWith('/blocks')).at(-1) as [string, { json: { blocks: unknown[] } }];
  expect(path).toBe('/rooms/room-1/sections/section-1/blocks');
  return init.json.blocks;
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (path: string) => (path.endsWith('/tags/main') ? [{ tag_ids: ['t2'] }] : rawSection()) as never);
  vi.spyOn(notifications, 'show').mockReturnValue('id');
});

describe('SectionEditor', () => {
  it('opens a new Section on the block tiles, and adds a maps block at once', async () => {
    editor([], { pathname: '/rooms/room-1/sections/section-1', state: { landingEdit: 'add-block' } });
    expect(screen.getByText('Nessun blocco ancora: aggiungine uno.')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /Mappe/ }));
    expect(savedBlocks()).toEqual([{ kind: 'maps', heading: null, tag_ids: [], groups: [], map_kind: null, features: [] }]);
  });

  it('keeps a new Documents block as a draft until its first Tag', async () => {
    editor();
    await userEvent.click(screen.getByRole('button', { name: 'Blocco' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Blocco' }));
    await userEvent.click(screen.getByRole('button', { name: /Documenti/ }));
    expect(screen.queryByText('Nessun blocco ancora: aggiungine uno.')).not.toBeInTheDocument();
    // Closing its Tag picker empty drops it.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Sposta il blocco' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/blocks'))).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Blocco' }));
    await userEvent.click(screen.getByRole('button', { name: /Documenti/ }));
    await userEvent.click(screen.getByRole('button', { name: '#PNG' }));
    expect(savedBlocks()).toEqual([{ kind: 'documents', heading: null, tag_ids: ['t2'], groups: [], map_kind: null, features: [] }]);
  });

  it('keeps a Session 0 draft until its first feature', async () => {
    editor([mapsBlock]);
    await userEvent.click(screen.getByRole('button', { name: 'Blocco' }));
    await userEvent.click(screen.getByRole('button', { name: /Sessione 0/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Retro' }));
    expect(savedBlocks()).toEqual([
      wire(mapsBlock),
      { kind: 'session_zero', heading: null, tag_ids: [], groups: [], map_kind: null, features: ['retro'] },
    ]);
    fetchMock.mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'Blocco' }));
    await userEvent.click(screen.getByRole('button', { name: /Sessione 0/ }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getAllByRole('button', { name: 'Azioni del blocco' })).toHaveLength(1);
  });

  it('inserts a block between two, a draft in its place', async () => {
    editor([plainBlock, mapsBlock]);
    await userEvent.click(screen.getByRole('button', { name: 'Inserisci un blocco qui' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Mappe/ }));
    expect(savedBlocks()).toEqual([wire(plainBlock), wire(rawBlock({ kind: 'maps', tag_ids: [] })), wire(mapsBlock)]);

    await userEvent.click(screen.getByRole('button', { name: 'Inserisci un blocco qui' }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Inserisci un blocco qui' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Documenti/ }));
    await userEvent.click(screen.getByRole('button', { name: '#Yakuza' }));
    expect(savedBlocks()).toEqual([wire(plainBlock), wire(rawBlock({ tag_ids: ['t3'] })), wire(mapsBlock)]);
  });

  it('reorders, changes and deletes blocks, with an undo', async () => {
    editor([plainBlock, mapsBlock]);
    await userEvent.click(screen.getByRole('button', { name: 'Riordina block-4,block-3' }));
    expect(savedBlocks()).toEqual([wire(mapsBlock), wire(plainBlock)]);

    await userEvent.click(screen.getByRole('button', { name: 'Mappe mostrate: Tutte le mappe' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Relazioni' }));
    expect(savedBlocks()).toEqual([wire(plainBlock), { ...wire(mapsBlock), map_kind: 'free' }]);

    await userEvent.click(screen.getAllByRole('button', { name: 'Azioni del blocco' })[0]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Elimina blocco' }));
    expect(savedBlocks()).toEqual([wire(mapsBlock)]);
    await waitFor(() => expect(notifications.show).toHaveBeenCalled());
    const toast = vi.mocked(notifications.show).mock.calls[0][0];
    expect(toast.autoClose).toBe(5000);
    render(<MantineProvider theme={theme} env="test">{toast.message as ReactElement}</MantineProvider>);
    expect(screen.getByText('Blocco eliminato')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(savedBlocks()).toEqual([wire(plainBlock), wire(mapsBlock)]);
  });

  it('tells when a save is refused', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/tags/main')) return [] as never;
      throw new Error('Troppi');
    });
    editor([mapsBlock]);
    await userEvent.click(screen.getByRole('button', { name: 'Riordina block-3' }));
    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Troppi' })));
  });

  it('reorders the sub-sections on screen, the empty ones keeping their place', async () => {
    editor([documentsBlock, zeroBlock, plainBlock]);
    expect(screen.getAllByRole('button', { name: 'Sposta la sottosezione' })).toHaveLength(2 + 2);
    await userEvent.click(screen.getByRole('button', { name: 'Riordina t2,t3' }));
    expect(savedBlocks()[0]).toEqual({ ...wire(documentsBlock), groups: [['t3'], ['gone'], ['t2']] });
    await userEvent.click(screen.getByRole('button', { name: 'Riordina retro,polls' }));
    expect(savedBlocks()[1]).toEqual({ ...wire(zeroBlock), features: ['polls', 'stars_wishes', 'retro'] });
  });

  it('adds no block past ten', () => {
    editor(Array.from({ length: 10 }, (_, index) => rawBlock({ id: `b${index}`, kind: 'maps', tag_ids: [] })));
    expect(screen.queryByRole('button', { name: 'Blocco' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inserisci un blocco qui' })).not.toBeInTheDocument();
  });
});
