import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../lib/apiClient';
import { useSession } from '../../hooks/useSession';
import { ViewAsContext } from '../../hooks/useViewAs';
import type { Board } from '../../types/map';
import type { GeoBoard } from '../../types/geoMap';
import { fakeSession, rawGeoMapDetail, rawMapDetail, rawMember } from '../fixtures';
import { renderWithProviders } from '../utils';
import { RelationshipMapPage } from '../../pages/RelationshipMapPage';

vi.mock('../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../../hooks/useSession', () => ({ useSession: vi.fn() }));

// The board has its own tests: here it only reports how it was drawn, and
// makes one change when asked.
vi.mock('../../components/maps/MapBoard', () => ({
  MapBoard: ({
    board,
    editable,
    isMaster,
    onChange,
    onSelectDocument,
  }: {
    board: Board;
    editable: boolean;
    isMaster: boolean;
    onChange: (board: Board) => void;
    onSelectDocument?: (documentId: string) => void;
  }) => (
    <div data-testid="board" data-editable={String(editable)} data-master={String(isMaster)}>
      {board.cards.length} cards
      <button type="button" onClick={() => onChange({ ...board, cards: board.cards.slice(1) })}>
        change
      </button>
      {onSelectDocument && (
        <button type="button" onClick={() => onSelectDocument('doc-9')}>
          select
        </button>
      )}
    </div>
  ),
}));

vi.mock('../../components/maps/GeographicBoard', () => ({
  GeographicBoard: ({
    board,
    editable,
    planeWidth,
    tags,
    onChange,
    onSelectDocument,
  }: {
    board: GeoBoard;
    editable: boolean;
    planeWidth: number;
    tags: unknown[];
    onChange: (board: GeoBoard) => void;
    onSelectDocument?: (documentId: string) => void;
  }) => (
    <div data-testid="geo-board" data-editable={String(editable)} data-plane={planeWidth} data-tags={tags.length}>
      {board.areas.length} areas
      <button type="button" onClick={() => onChange({ ...board, areas: board.areas.slice(1) })}>
        change
      </button>
      {onSelectDocument && (
        <button type="button" onClick={() => onSelectDocument('doc-9')}>
          select
        </button>
      )}
    </div>
  ),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}));

const fetchMock = vi.mocked(apiFetch);
const sessionMock = vi.mocked(useSession);
type SessionState = ReturnType<typeof useSession>;
type Init = { method?: string; json?: unknown };

const routes = {
  map: () => Promise.resolve(rawMapDetail()) as Promise<unknown>,
  geo: () => Promise.resolve(rawGeoMapDetail()) as Promise<unknown>,
  saveGeo: () => Promise.resolve(rawGeoMapDetail()) as Promise<unknown>,
  save: () => Promise.resolve(rawMapDetail()) as Promise<unknown>,
  update: () => Promise.resolve(rawMapDetail({ name: 'La Corte rinnovata' })) as Promise<unknown>,
  remove: () => Promise.resolve(undefined) as Promise<unknown>,
  members: [rawMember({ user_id: 'user-1', role: 'master' })] as unknown,
};

const originalMatchMedia = window.matchMedia;

function wideScreen() {
  window.matchMedia = ((query: string) => ({
    ...originalMatchMedia(query),
    matches: true,
  })) as typeof window.matchMedia;
}

function render(previewing = false, route = '/rooms/room-1/maps/map-1') {
  renderWithProviders(
    <Routes>
      <Route path="/rooms/:roomId/maps/:mapId" element={<RelationshipMapPage />} />
      <Route path="/rooms/:roomId/maps" element={<RelationshipMapPage />} />
    </Routes>,
    {
      route,
      wrapper: previewing
        ? ({ children }) => (
            <ViewAsContext.Provider value={{ roomId: 'room-1', userId: 'user-2' }}>{children}</ViewAsContext.Provider>
          )
        : undefined,
    },
  );
  return { user: userEvent.setup() };
}

beforeEach(() => {
  fetchMock.mockReset();
  navigate.mockReset();
  routes.map = () => Promise.resolve(rawMapDetail());
  routes.geo = () => Promise.resolve(rawGeoMapDetail());
  routes.saveGeo = () => Promise.resolve(rawGeoMapDetail());
  routes.save = () => Promise.resolve(rawMapDetail());
  routes.update = () => Promise.resolve(rawMapDetail({ name: 'La Corte rinnovata' }));
  routes.remove = () => Promise.resolve(undefined);
  routes.members = [rawMember({ user_id: 'user-1', role: 'master' })];
  sessionMock.mockReturnValue({ session: fakeSession('user-1'), loading: false } as SessionState);
  fetchMock.mockImplementation((path: string, init?: Init) => {
    if (path === '/rooms/room-1/maps/map-1/board') return routes.save();
    if (path === '/rooms/room-1/maps/map-1/geo' && init?.method === 'PUT') return routes.saveGeo();
    if (path === '/rooms/room-1/maps/map-1/geo') return routes.geo();
    if (path === '/rooms/room-1/tags') return Promise.resolve([{ id: 'tag-1', name: 'Camarilla', category: null, main_position: null }]);
    if (path === '/rooms/room-1/maps/map-1' && init?.method === 'PATCH') return routes.update();
    if (path === '/rooms/room-1/maps/map-1' && init?.method === 'DELETE') return routes.remove();
    if (path === '/rooms/room-1/maps/map-1') return routes.map();
    if (path === '/rooms/room-1/members') return Promise.resolve(routes.members);
    return Promise.resolve([]);
  });
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('RelationshipMapPage', () => {
  it('waits for the session, and asks to sign in without one', () => {
    sessionMock.mockReturnValue({ session: null, loading: true } as SessionState);
    render();
    expect(document.querySelector('.mantine-Loader-root')).toBeInTheDocument();
  });

  it('asks to sign in without a session', () => {
    sessionMock.mockReturnValue({ session: null, loading: false } as SessionState);
    render();
    expect(screen.getByText('Accedi per vedere le mappe di questa Stanza.')).toBeInTheDocument();
  });

  it('renders nothing without a map in the URL', () => {
    render(false, '/rooms/room-1/maps');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says when the map cannot be found', async () => {
    routes.map = () => Promise.reject(new ApiError(404, 'Not found'));
    render();
    expect(await screen.findByText('Mappa non trovata.')).toBeInTheDocument();
  });

  it('shows the map read-only on a phone', async () => {
    render();
    expect(await screen.findByRole('heading', { name: 'La Corte' })).toBeInTheDocument();
    expect(screen.getByText('Chi serve chi')).toBeInTheDocument();
    expect(await screen.findByText(/sola lettura/)).toBeInTheDocument();
    expect(screen.getByTestId('board')).toHaveAttribute('data-editable', 'false');
  });

  it('saves the board shortly after a change and says so', async () => {
    wideScreen();
    const { user } = render();
    const board = await screen.findByTestId('board');
    expect(board).toHaveAttribute('data-editable', 'true');
    await vi.waitFor(() => expect(board).toHaveAttribute('data-master', 'true'));

    await user.click(screen.getByRole('button', { name: 'change' }));
    expect(screen.getByRole('status')).toHaveTextContent('Modifiche non salvate');
    expect(board).toHaveTextContent('2 cards');
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvato'), { timeout: 2000 });
    expect(fetchMock).toHaveBeenCalledWith(
      '/rooms/room-1/maps/map-1/board',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('shows why a save failed and retries it', async () => {
    wideScreen();
    routes.save = () => Promise.reject(new ApiError(409, 'Troppe carte'));
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'change' }));
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Troppe carte'), { timeout: 2000 });

    routes.save = () => Promise.resolve(rawMapDetail());
    await user.click(screen.getByRole('button', { name: 'Riprova' }));
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvato'));
  });

  it('falls back to a generic message when a save fails without one', async () => {
    wideScreen();
    routes.save = () => Promise.reject(new ApiError(500, ''));
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'change' }));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Riprova' })).toBeInTheDocument(), {
      timeout: 2000,
    });
  });

  it('changes the map settings', async () => {
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Impostazioni della mappa' }));
    const name = screen.getByRole('textbox', { name: /Nome/ });
    await user.clear(name);
    await user.type(name, 'La Corte rinnovata');
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/rooms/room-1/maps/map-1',
        expect.objectContaining({ method: 'PATCH', json: expect.objectContaining({ name: 'La Corte rinnovata' }) }),
      ),
    );
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Salva' })).not.toBeInTheDocument());
  });

  it('shows why the settings were refused, and forgets it on close', async () => {
    routes.update = () => Promise.reject(new ApiError(422, 'Nome già usato'));
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Impostazioni della mappa' }));
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await screen.findByText('Nome già usato')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Impostazioni della mappa' }));
    expect(screen.queryByText('Nome già usato')).not.toBeInTheDocument();
  });

  it('deletes the map after confirming, then goes back to the maps', async () => {
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Elimina mappa' }));
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    await user.click(screen.getByRole('button', { name: 'Elimina mappa' }));
    await user.click(await screen.findByRole('button', { name: 'Elimina' }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/rooms/room-1/maps'));
  });

  it('shows why the map could not be deleted', async () => {
    routes.remove = () => Promise.reject(new ApiError(403, 'Non puoi'));
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Elimina mappa' }));
    await user.click(await screen.findByRole('button', { name: 'Elimina' }));
    expect(await screen.findByText('Non puoi')).toBeInTheDocument();
  });

  it('offers no editing in a preview, nor to whoever cannot edit', async () => {
    wideScreen();
    render(true);
    const board = await screen.findByTestId('board');
    expect(board).toHaveAttribute('data-editable', 'false');
    expect(board).toHaveAttribute('data-master', 'false');
    expect(screen.queryByRole('button', { name: 'Impostazioni della mappa' })).not.toBeInTheDocument();
    expect(screen.queryByText(/sola lettura/)).not.toBeInTheDocument();
  });

  it('shows a map without a description to someone who cannot edit it', async () => {
    routes.map = () => Promise.resolve(rawMapDetail({ description: '', can_edit: false }));
    render();
    await screen.findByRole('heading', { name: 'La Corte' });
    expect(screen.queryByRole('button', { name: 'Elimina mappa' })).not.toBeInTheDocument();
  });

  it('opens the settings before the members load, with no selective list', async () => {
    routes.map = () => Promise.resolve(rawMapDetail({ selective_user_ids: null }));
    routes.members = new Promise(() => {});
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Impostazioni della mappa' }));
    expect(screen.getByRole('textbox', { name: /Nome/ })).toHaveValue('La Corte');
  });

  it('draws the board before the Room Documents and Tags load', async () => {
    const answer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((path: string, init?: Init) =>
      /\/(documents|tags)/.test(path) ? new Promise(() => {}) : answer(path, init),
    );
    render();
    expect(await screen.findByTestId('board')).toHaveTextContent('cards');
  });

  it('closes the delete confirmation with Escape', async () => {
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Elimina mappa' }));
    expect(await screen.findByText('Eliminare questa mappa?')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByText('Eliminare questa mappa?')).not.toBeInTheDocument());
  });

  it('splits the screen with a button, and a click on a card shows its Document (spec 37)', async () => {
    wideScreen();
    const { user } = render(false, '/rooms/room-1/maps/map-1');
    expect(await screen.findByTestId('board')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'select' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mostra il pannello affiancato' }));
    expect(await screen.findByText('Seleziona una card per vederne le info')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'select' }));
    expect(await screen.findByRole('link', { name: 'Apri il Documento' })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents/doc-9',
    );

    await user.click(screen.getByRole('button', { name: 'Nascondi il pannello affiancato' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  describe('a geographic map (spec 38)', () => {
    const geographic = () =>
      Promise.resolve(rawMapDetail({ kind: 'geographic', plane_width: 2000, plane_height: 1400, groups: [], cards: [], arrows: [] }));

    it('draws its plane, with the Tag filter for everyone, and saves a change', async () => {
      wideScreen();
      routes.map = geographic;
      const { user } = render();
      const board = await screen.findByTestId('geo-board');
      expect(board).toHaveAttribute('data-plane', '2000');
      expect(board).toHaveTextContent('2 areas');
      await vi.waitFor(() => expect(board).toHaveAttribute('data-tags', '1'));
      await user.click(screen.getByRole('button', { name: 'change' }));
      expect(board).toHaveTextContent('1 areas');
      await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvato'), { timeout: 2000 });
      expect(fetchMock).toHaveBeenCalledWith(
        '/rooms/room-1/maps/map-1/geo',
        expect.objectContaining({ method: 'PUT', json: expect.objectContaining({ areas: [expect.objectContaining({ id: 'area-2' })] }) }),
      );
    });

    it('opens the plane dialog for whoever manages the map', async () => {
      wideScreen();
      routes.map = geographic;
      const { user } = render();
      await user.click(await screen.findByRole('button', { name: 'Mappa' }));
      expect(await screen.findByRole('textbox', { name: 'Larghezza' })).toHaveValue('2000');
      await user.keyboard('{Escape}');
      await vi.waitFor(() => expect(screen.queryByRole('textbox', { name: 'Larghezza' })).not.toBeInTheDocument());
    });

    it('offers no plane dialog to whoever cannot edit, and shows its Documents in the split', async () => {
      wideScreen();
      routes.map = () => geographic().then((map) => ({ ...map, can_edit: false }));
      routes.geo = () => Promise.resolve(rawGeoMapDetail({ can_edit: false }));
      const { user } = render();
      expect(await screen.findByTestId('geo-board')).toHaveAttribute('data-editable', 'false');
      expect(screen.queryByRole('button', { name: 'Mappa' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Mostra il pannello affiancato' }));
      await user.click(await screen.findByRole('button', { name: 'select' }));
      expect(await screen.findByRole('link', { name: 'Apri il Documento' })).toHaveAttribute('href', '/rooms/room-1/documents/doc-9');
    });

    it('waits for its content, and says when it cannot be found', async () => {
      routes.map = geographic;
      routes.geo = () => new Promise(() => {});
      render();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps/map-1/geo'));
      expect(document.querySelector('.mantine-Loader-root')).toBeInTheDocument();
    });

    it('says the map is not found when its content fails to load', async () => {
      routes.map = geographic;
      routes.geo = () => Promise.reject(new ApiError(404, 'Not found'));
      render();
      expect(await screen.findByText('Mappa non trovata.')).toBeInTheDocument();
    });
  });
});
