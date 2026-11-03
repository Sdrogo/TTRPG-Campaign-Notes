import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import type { ReactElement } from 'react';
import type { InitialEntry } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SectionEditor } from '../../../components/landing/SectionEditor';
import type { BlockSources } from '../../../components/landing/blockItems';
import { apiFetch } from '../../../lib/apiClient';
import { rawBlock, rawPoll, rawSection } from '../../fixtures';
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
  return { collapsed: false, module_id: null, ...rest };
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
    expect(savedBlocks()).toEqual([{ kind: 'maps', heading: null, tag_ids: [], groups: [], map_kind: null, features: [], module_id: null, collapsed: false }]);
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
    expect(savedBlocks()).toEqual([{ kind: 'documents', heading: null, tag_ids: ['t2'], groups: [], map_kind: null, features: [], module_id: null, collapsed: false }]);
  });

  it('keeps a Session 0 draft until its first feature', async () => {
    editor([mapsBlock]);
    await userEvent.click(screen.getByRole('button', { name: 'Blocco' }));
    await userEvent.click(screen.getByRole('button', { name: /Sessione 0/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Retro' }));
    expect(savedBlocks()).toEqual([
      wire(mapsBlock),
      { kind: 'session_zero', heading: null, tag_ids: [], groups: [], map_kind: null, features: ['retro'], module_id: null, collapsed: false },
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

  it('keeps the groups popover open while groups are added, each save remounting the bar', async () => {
    const { rerender } = editor([plainBlock, mapsBlock]);
    const remount = (block: Record<string, unknown>) =>
      rerender(<SectionEditor roomId="room-1" section={section({ blocks: [block, mapsBlock] })} sources={sources} />);
    await userEvent.click(screen.getByRole('button', { name: 'Raggruppa' }));
    await userEvent.click(screen.getByRole('button', { name: 'Gruppo' }));
    await userEvent.click(screen.getByRole('checkbox', { name: '#PNG' }));
    await userEvent.click(screen.getByRole('button', { name: 'Aggiungi' }));
    expect(savedBlocks()[0]).toEqual({ ...wire(plainBlock), groups: [['t2']] });
    // The saved list comes back with new block ids: a new bar, still open.
    remount(rawBlock({ id: 'block-4b', tag_ids: ['t1'], groups: [['t2']] }));
    expect(await screen.findByRole('button', { name: 'Gruppo' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Gruppo' }));
    await userEvent.click(screen.getByRole('checkbox', { name: '#Yakuza' }));
    await userEvent.click(screen.getByRole('button', { name: 'Aggiungi' }));
    expect(savedBlocks()[0]).toEqual({ ...wire(plainBlock), groups: [['t2'], ['t3']] });
    remount(rawBlock({ id: 'block-4c', tag_ids: ['t1'], groups: [['t2'], ['t3']] }));
    expect(await screen.findByRole('button', { name: 'Togli #Yakuza' })).toBeInTheDocument();
    // Once closed it stays closed.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Gruppo' })).not.toBeInTheDocument());
    remount(rawBlock({ id: 'block-4d', tag_ids: ['t1'], groups: [['t2'], ['t3']] }));
    expect(screen.queryByRole('button', { name: 'Gruppo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2 gruppi' })).toBeInTheDocument();
  });

  it('closes the groups popover when the blocks move', async () => {
    const { rerender } = editor([plainBlock, documentsBlock]);
    await userEvent.click(screen.getByRole('button', { name: 'Raggruppa' }));
    expect(screen.getByRole('button', { name: 'Gruppo' })).toBeInTheDocument();
    // A click with no pointer down, so the popover isn't closed by it first.
    fireEvent.click(screen.getByRole('button', { name: 'Riordina block-4,block-1' }));
    await waitFor(() => expect(savedBlocks()).toEqual([wire(documentsBlock), wire(plainBlock)]));
    rerender(<SectionEditor roomId="room-1" section={section({ blocks: [{ ...documentsBlock, id: 'block-1b' }, { ...plainBlock, id: 'block-4b' }] })} sources={sources} />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Gruppo' })).not.toBeInTheDocument());
  });

  it('adds no block past ten', () => {
    editor(Array.from({ length: 10 }, (_, index) => rawBlock({ id: `b${index}`, kind: 'maps', tag_ids: [] })));
    expect(screen.queryByRole('button', { name: 'Blocco' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inserisci un blocco qui' })).not.toBeInTheDocument();
  });

  describe('tools (spec 60)', () => {
    const toolBlock = rawBlock({ id: 'block-5', kind: 'tool', tag_ids: [], module_id: 'm-1', tool_kind: 'poll', players_visible: false });
    const toolSaved = { kind: 'tool', heading: null, tag_ids: [], groups: [], map_kind: null, features: [], module_id: 'm-1', collapsed: false };

    function answerTools(blocks: Record<string, unknown>[]) {
      fetchMock.mockImplementation(async (path: string) => (path.endsWith('/tools') ? rawSection({ blocks }) : rawSection()) as never);
    }

    it('adds a tool last, then moves it where it was picked', async () => {
      answerTools([plainBlock, mapsBlock, toolBlock]);
      editor([plainBlock, mapsBlock]);
      await userEvent.click(screen.getByRole('button', { name: 'Inserisci un blocco qui' }));
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sondaggio' }));
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/sections/section-1/tools', { method: 'POST', json: { kind: 'poll' } });
      await waitFor(() => expect(savedBlocks()).toEqual([wire(plainBlock), toolSaved, wire(mapsBlock)]));
    });

    it('adds a tool at the end with no move, and tells when it is refused', async () => {
      answerTools([plainBlock, toolBlock]);
      editor([plainBlock]);
      await userEvent.click(screen.getByRole('button', { name: 'Blocco' }));
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Retro' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/sections/section-1/tools', { method: 'POST', json: { kind: 'retro' } }));
      expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/blocks'))).toBe(false);

      fetchMock.mockRejectedValue(new Error('no'));
      await userEvent.click(screen.getByRole('button', { name: 'Blocco' }));
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'DDI' }));
      await waitFor(() => expect(notifications.show).toHaveBeenCalled());
    });

    it('shows and hides a tool from its bar', async () => {
      editor([toolBlock]);
      expect(screen.getByText('Bozza')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Mostra ai giocatori' }));
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/sections/section-1/tools/m-1/visible', { method: 'PUT', json: { visible: true } });

    });

    it('hides a shown tool from its bar', async () => {
      editor([{ ...toolBlock, players_visible: true }]);
      expect(screen.queryByText('Bozza')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Nascondi ai giocatori' }));
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/sections/section-1/tools/m-1/visible', { method: 'PUT', json: { visible: false } });
    });

    it('asks before deleting a tool, with no undo', async () => {
      editor([plainBlock, toolBlock]);
      const menus = screen.getAllByRole('button', { name: 'Azioni del blocco' });
      await userEvent.click(menus[1]);
      await userEvent.click(screen.getByRole('menuitem', { name: 'Elimina blocco' }));
      expect(screen.getByText('Eliminare Sondaggio?')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Annulla' }));
      expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/blocks'))).toBe(false);
      await userEvent.click(menus[1]);
      await userEvent.click(screen.getByRole('menuitem', { name: 'Elimina blocco' }));
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByText('Eliminare Sondaggio?')).not.toBeInTheDocument());

      await userEvent.click(menus[1]);
      await userEvent.click(screen.getByRole('menuitem', { name: 'Elimina blocco' }));
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Eliminare Sondaggio?' })).getByRole('button', { name: 'Elimina blocco' }));
      expect(savedBlocks()).toEqual([wire(plainBlock)]);
    });

    it('deletes the tool it asked about even when the list changed meanwhile, and closes once it is gone', async () => {
      const { rerender } = editor([plainBlock, toolBlock]);
      await userEvent.click(screen.getAllByRole('button', { name: 'Azioni del blocco' })[1]);
      await userEvent.click(screen.getByRole('menuitem', { name: 'Elimina blocco' }));
      rerender(<SectionEditor roomId="room-1" section={section({ blocks: [toolBlock, plainBlock, mapsBlock] })} sources={sources} />);
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Eliminare Sondaggio?' })).getByRole('button', { name: 'Elimina blocco' }));
      expect(savedBlocks()).toEqual([wire(plainBlock), wire(mapsBlock)]);

      await userEvent.click(screen.getAllByRole('button', { name: 'Azioni del blocco' })[0]);
      await userEvent.click(screen.getByRole('menuitem', { name: 'Elimina blocco' }));
      expect(screen.getByText('Eliminare Sondaggio?')).toBeInTheDocument();
      rerender(<SectionEditor roomId="room-1" section={section({ blocks: [plainBlock] })} sources={sources} />);
      await waitFor(() => expect(screen.queryByText('Eliminare Sondaggio?')).not.toBeInTheDocument());
    });

    it('draws its tool in edit mode once the tools are read', () => {
      const module = { id: 'm-1', kind: 'poll' as const, position: 0, columns: [], polls: [rawPoll()] as never };
      renderWithProviders(
        <SectionEditor
          roomId="room-1"
          section={section({ blocks: [toolBlock] })}
          sources={{ ...sources, tools: { revision: 1, tools: [{ moduleId: 'm-1', playersVisible: false, module }] } }}
        />,
      );
      expect(screen.getByText('Quale sistema?')).toBeInTheDocument();
    });

    it('sets a block to start folded', async () => {
      editor([plainBlock]);
      await userEvent.click(screen.getByRole('button', { name: 'Azioni del blocco' }));
      await userEvent.click(screen.getByRole('menuitem', { name: "Chiuso all'apertura" }));
      expect(savedBlocks()).toEqual([{ ...wire(plainBlock), collapsed: true }]);
    });

    it('sets a folded block to start open', async () => {
      editor([{ ...plainBlock, collapsed: true }]);
      await userEvent.click(screen.getByRole('button', { name: 'Azioni del blocco' }));
      await userEvent.click(screen.getByRole('menuitem', { name: /Chiuso all'apertura/ }));
      expect(savedBlocks()).toEqual([wire(plainBlock)]);
    });
  });
});
