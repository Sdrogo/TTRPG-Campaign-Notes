import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { useSession } from '../../hooks/useSession';
import {
  fakeSession,
  rawAccount,
  rawBlock,
  rawDocument,
  rawMap,
  rawMember,
  rawRoom,
  rawSection,
  rawSections,
  rawSessionZeroOverview,
} from '../fixtures';
import { renderWithProviders } from '../utils';
import { RoomSectionPage } from '../../pages/RoomSectionPage';

vi.mock('../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../../hooks/useSession', () => ({ useSession: vi.fn() }));
vi.mock('../../lib/roomEvents', () => ({ readRoomEvents: vi.fn(() => new Promise<void>(() => {})) }));

const fetchMock = vi.mocked(apiFetch);
const sessionMock = vi.mocked(useSession);
type SessionState = ReturnType<typeof useSession>;

const blocks = [
  rawBlock({ id: 'b-docs', tag_ids: ['tag-1'], groups: [['tag-2']] }),
  rawBlock({ id: 'b-maps', kind: 'maps', tag_ids: [] }),
  rawBlock({ id: 'b-zero', kind: 'session_zero', tag_ids: [], features: ['retro', 'polls'] }),
  rawBlock({ id: 'b-ddi', kind: 'session_zero', tag_ids: [], features: ['ddi'], heading: 'Il patto' }),
];

let sections: () => Promise<unknown>;
let room: () => Promise<unknown>;
let members: unknown;
let maps: unknown;

function render(route = '/rooms/room-1/sections/section-1') {
  renderWithProviders(
    <Routes>
      <Route path="/rooms/:roomId/sections/:sectionId" element={<RoomSectionPage />} />
    </Routes>,
    { route },
  );
  return userEvent.setup();
}

beforeEach(() => {
  fetchMock.mockReset();
  sections = () => Promise.resolve(rawSections([rawSection({ description: '**Neon** di notte', blocks })]));
  room = () => Promise.resolve(rawRoom());
  members = [rawMember()];
  maps = [rawMap()];
  sessionMock.mockReturnValue({ session: fakeSession('user-1'), loading: false } as SessionState);
  fetchMock.mockImplementation((path: string) => {
    switch (path) {
      case '/rooms/room-1/sections':
        return sections();
      case '/rooms/room-1':
        return room();
      case '/rooms/room-1/members':
        return Promise.resolve(members);
      case '/rooms/room-1/tags':
        return Promise.resolve([
          { id: 'tag-1', name: 'Tokyo', category: null },
          { id: 'tag-2', name: 'PNG', category: null },
        ]);
      case '/rooms/room-1/documents':
        return Promise.resolve([
          rawDocument({ id: 'd1', name: 'Aiko', tag_ids: ['tag-1', 'tag-2'] }),
          rawDocument({ id: 'd2', name: 'Bunta', tag_ids: ['tag-1'] }),
        ]);
      case '/rooms/room-1/maps':
        return Promise.resolve(maps);
      case '/rooms/room-1/session-zero/overview':
        return Promise.resolve(rawSessionZeroOverview());
      case '/account':
        return Promise.resolve(rawAccount());
      default:
        return Promise.resolve([]);
    }
  });
});

describe('RoomSectionPage', () => {
  it('waits for the session, and asks to sign in without one', () => {
    sessionMock.mockReturnValue({ session: null, loading: true } as SessionState);
    const { container } = renderWithProviders(
      <Routes>
        <Route path="/rooms/:roomId/sections/:sectionId" element={<RoomSectionPage />} />
      </Routes>,
      { route: '/rooms/room-1/sections/section-1' },
    );
    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
  });

  it('asks to sign in without a session', () => {
    sessionMock.mockReturnValue({ session: null, loading: false } as SessionState);
    render();
    expect(screen.getByText('Accedi per vedere i Documenti di questa Stanza.')).toBeInTheDocument();
  });

  it('renders nothing without a Section in the URL', () => {
    renderWithProviders(<RoomSectionPage />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the Section and its blocks, and lists them in the Index', async () => {
    const user = render();
    expect(await screen.findByRole('heading', { level: 1, name: 'Tokyo' })).toBeInTheDocument();
    expect(await screen.findByText('La Cripta')).toBeInTheDocument();
    expect(screen.getByText('Neon di notte')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Aiko' })).toHaveAttribute('href', '/rooms/room-1/documents/d1');
    expect(screen.getByRole('link', { name: 'Bunta' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'La Corte' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Retro · Sessione 0' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Il patto' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifica' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Apri l.indice della Stanza/ }));
    expect(await screen.findByRole('button', { name: 'Documenti · #Tokyo' })).toBeInTheDocument();
    const index = screen.getByRole('dialog');
    expect(within(index).getByText('#PNG')).toBeInTheDocument();
    expect(within(index).getByText('Sondaggi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Il patto' })).toBeInTheDocument();
  });

  it('names the Room after its home while the Room loads', async () => {
    room = () => new Promise(() => {});
    render();
    expect(await screen.findByRole('heading', { level: 1, name: 'Tokyo' })).toBeInTheDocument();
    expect(screen.getAllByText('Home della Stanza').length).toBeGreaterThan(0);
  });

  it('shows an empty state for a Section with nothing the viewer sees', async () => {
    sections = () => Promise.resolve(rawSections([rawSection({ blocks: [rawBlock({ id: 'b', kind: 'maps', tag_ids: [] })] })]));
    maps = [];
    render();
    expect(await screen.findByText('Ancora niente da mostrare qui.')).toBeInTheDocument();
  });

  it('shows an empty state for a Section without blocks', async () => {
    sections = () => Promise.resolve(rawSections([rawSection()]));
    render();
    expect(await screen.findByText('Ancora niente da mostrare qui.')).toBeInTheDocument();
  });

  it('shows the Master an empty block, and edits the Section in place', async () => {
    members = [rawMember({ role: 'master' })];
    sections = () => Promise.resolve(rawSections([rawSection({ blocks: [rawBlock({ id: 'b', kind: 'maps', tag_ids: [] })] })]));
    maps = [];
    const user = render();
    expect(await screen.findByText('Niente da mostrare')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Modifica' }));
    expect(screen.getByRole('button', { name: 'Sposta il blocco' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fine' }));
    expect(screen.queryByRole('button', { name: 'Sposta il blocco' })).not.toBeInTheDocument();
  });

  it('says when the Section is gone', async () => {
    render('/rooms/room-1/sections/gone');
    expect(await screen.findByText('Questa sezione non esiste più.')).toBeInTheDocument();
  });

  it('says when the landing fails to load', async () => {
    sections = () => Promise.reject(new Error('no'));
    render();
    expect(await screen.findByText('Impossibile caricare la pagina.')).toBeInTheDocument();
  });
});
