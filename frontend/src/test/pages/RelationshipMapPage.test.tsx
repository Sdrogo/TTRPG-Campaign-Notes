import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../lib/apiClient';
import { useSession } from '../../hooks/useSession';
import { ViewAsContext } from '../../hooks/useViewAs';
import type { Board } from '../../types/map';
import type { GeoBoard } from '../../types/geoMap';
import { fakeSession, rawGeoMapDetail, rawMapCard, rawMapDetail, rawMember } from '../fixtures';
import { renderWithProviders } from '../utils';
import { RelationshipMapPage } from '../../pages/RelationshipMapPage';
import { saveBlob } from '../../lib/roomExport';
import { notifyError } from '../../lib/notify';

vi.mock('../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../../hooks/useSession', () => ({ useSession: vi.fn() }));
vi.mock('../../lib/roomExport', async (original) => ({
  ...(await original<typeof import('../../lib/roomExport')>()),
  saveBlob: vi.fn(),
}));
vi.mock('../../lib/notify', () => ({ notifyError: vi.fn() }));

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
  exportMap: () => Promise.resolve({ schema_version: 1 }) as Promise<unknown>,
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
  routes.exportMap = () => Promise.resolve({ schema_version: 1 });
  routes.members = [rawMember({ user_id: 'user-1', role: 'master' })];
  sessionMock.mockReturnValue({ session: fakeSession('user-1'), loading: false } as SessionState);
  fetchMock.mockImplementation((path: string, init?: Init) => {
    if (path === '/rooms/room-1/maps/map-1/board') return routes.save();
    if (path === '/rooms/room-1/maps/map-1/export') return routes.exportMap();
    if (path === '/rooms/room-1/maps/map-1/geo' && init?.method === 'PATCH') return routes.saveGeo();
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

type User = ReturnType<typeof userEvent.setup>;

/** Unfolds the map's ⋮ menu. */
async function openActions(user: User) {
  await user.click(await screen.findByRole('button', { name: /^Azioni per la mappa/ }));
}

/** An entry of the map's ⋮ menu, unfolding it first. */
async function menuItem(user: User, name: string) {
  await openActions(user);
  return screen.findByRole('menuitem', { name });
}

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

  it('cuts the description short until a tap or a key opens it, and closes it again', async () => {
    const { user } = render();
    const description = await screen.findByRole('button', { name: 'Chi serve chi' });
    expect(description).toHaveAttribute('aria-expanded', 'false');
    await user.click(description);
    expect(description).toHaveAttribute('aria-expanded', 'true');
    await user.click(description);
    expect(description).toHaveAttribute('aria-expanded', 'false');
    description.focus();
    await user.keyboard('{Enter}');
    expect(description).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(' ');
    expect(description).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('a');
    expect(description).toHaveAttribute('aria-expanded', 'false');
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
      expect.objectContaining({ method: 'PATCH', json: expect.objectContaining({ deleted_ids: ['card-1'] }) }),
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
    await user.click(await menuItem(user, 'Impostazioni della mappa'));
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
    await user.click(await menuItem(user, 'Impostazioni della mappa'));
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await screen.findByText('Nome già usato')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(await menuItem(user, 'Impostazioni della mappa'));
    expect(screen.queryByText('Nome già usato')).not.toBeInTheDocument();
  });

  it('deletes the map after confirming, then goes back to the maps', async () => {
    const { user } = render();
    await user.click(await menuItem(user, 'Elimina mappa'));
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    await user.click(await menuItem(user, 'Elimina mappa'));
    await user.click(await screen.findByRole('button', { name: 'Elimina' }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/rooms/room-1/maps'));
  });

  it('shows why the map could not be deleted', async () => {
    routes.remove = () => Promise.reject(new ApiError(403, 'Non puoi'));
    const { user } = render();
    await user.click(await menuItem(user, 'Elimina mappa'));
    await user.click(await screen.findByRole('button', { name: 'Elimina' }));
    expect(await screen.findByText('Non puoi')).toBeInTheDocument();
  });

  it('offers no editing in a preview, nor to whoever cannot edit', async () => {
    wideScreen();
    const { user } = render(true);
    const board = await screen.findByTestId('board');
    expect(board).toHaveAttribute('data-editable', 'false');
    expect(board).toHaveAttribute('data-master', 'false');
    await openActions(user);
    expect(screen.queryByRole('menuitem', { name: 'Impostazioni della mappa' })).not.toBeInTheDocument();
    expect(screen.queryByText(/sola lettura/)).not.toBeInTheDocument();
  });

  it('shows a map without a description to someone who cannot edit it', async () => {
    routes.map = () => Promise.resolve(rawMapDetail({ description: '', can_edit: false, can_manage: false }));
    render();
    await screen.findByRole('heading', { name: 'La Corte' });
    // On a phone, with nothing to manage, there is no ⋮ at all.
    expect(screen.queryByRole('button', { name: /^Azioni per la mappa/ })).not.toBeInTheDocument();
  });

  it('opens the settings before the members load, with no selective list', async () => {
    routes.map = () => Promise.resolve(rawMapDetail({ selective_user_ids: null }));
    routes.members = new Promise(() => {});
    const { user } = render();
    await user.click(await menuItem(user, 'Impostazioni della mappa'));
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
    await user.click(await menuItem(user, 'Elimina mappa'));
    expect(await screen.findByText('Eliminare questa mappa?')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByText('Eliminare questa mappa?')).not.toBeInTheDocument());
  });

  it('splits the screen with a button, and a click on a card shows its Document (spec 37)', async () => {
    wideScreen();
    const { user } = render(false, '/rooms/room-1/maps/map-1');
    expect(await screen.findByTestId('board')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'select' })).not.toBeInTheDocument();

    await user.click(await menuItem(user, 'Mostra il pannello affiancato'));
    expect(await screen.findByText('Seleziona una card per vederne le info')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'select' }));
    expect(await screen.findByRole('link', { name: 'Apri il Documento' })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents/doc-9',
    );

    await user.click(await menuItem(user, 'Nascondi il pannello affiancato'));
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
        expect.objectContaining({ method: 'PATCH', json: expect.objectContaining({ areas: [], deleted_ids: ['area-1'] }) }),
      );
    });

    it('opens the plane dialog for whoever manages the map', async () => {
      wideScreen();
      routes.map = geographic;
      const { user } = render();
      await user.click(await menuItem(user, 'Mappa'));
      expect(await screen.findByRole('textbox', { name: 'Larghezza' })).toHaveValue('2000');
      await user.keyboard('{Escape}');
      await vi.waitFor(() => expect(screen.queryByRole('textbox', { name: 'Larghezza' })).not.toBeInTheDocument());
    });

    it('offers no plane dialog to whoever cannot edit, and shows its Documents in the split', async () => {
      wideScreen();
      routes.map = () => geographic().then((map) => ({ ...map, can_edit: false, can_manage: false }));
      routes.geo = () => Promise.resolve(rawGeoMapDetail({ can_edit: false, can_manage: false }));
      const { user } = render();
      expect(await screen.findByTestId('geo-board')).toHaveAttribute('data-editable', 'false');
      await openActions(user);
      expect(screen.queryByRole('menuitem', { name: 'Mappa' })).not.toBeInTheDocument();
      await user.keyboard('{Escape}');
      await user.click(await menuItem(user, 'Mostra il pannello affiancato'));
      await user.click(await screen.findByRole('button', { name: 'select' }));
      expect(await screen.findByRole('link', { name: 'Apri il Documento' })).toHaveAttribute('href', '/rooms/room-1/documents/doc-9');
    });

    it('downloads the map as a JSON file for whoever sees it (spec 38_3)', async () => {
      routes.map = () => geographic().then((map) => ({ ...map, can_edit: false, can_manage: false }));
      routes.geo = () => Promise.resolve(rawGeoMapDetail({ can_edit: false, can_manage: false }));
      const { user } = render();
      await user.click(await menuItem(user, 'Esporta la mappa (JSON)'));
      await vi.waitFor(() => expect(saveBlob).toHaveBeenCalled());
      const [blob, name] = vi.mocked(saveBlob).mock.calls[0] as [Blob, string];
      expect(name).toMatch(/^shibuya-di-notte-\d{4}-\d{2}-\d{2}\.json$/);
      expect(JSON.parse(await blob.text())).toEqual({ schema_version: 1 });
    });

    it('says why the map could not be exported', async () => {
      routes.map = geographic;
      routes.exportMap = () => Promise.reject(new ApiError(404, 'Mappa non trovata'));
      const { user } = render();
      await user.click(await menuItem(user, 'Esporta la mappa (JSON)'));
      await vi.waitFor(() => expect(notifyError).toHaveBeenCalledWith(new ApiError(404, 'Mappa non trovata')));
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

  describe('maps editable by players (spec 42)', () => {
    it('lets a Player edit an unlocked map, without its settings or deletion', async () => {
      wideScreen();
      routes.members = [rawMember({ user_id: 'user-1', role: 'player' })];
      routes.map = () =>
        Promise.resolve(rawMapDetail({ players_can_edit: true, can_edit: true, can_manage: false, selective_user_ids: null }));
      const { user } = render();
      expect(await screen.findByTestId('board')).toHaveAttribute('data-editable', 'true');
      expect(screen.getByText('Modificabile dai Player')).toBeInTheDocument();
      await openActions(user);
      expect(screen.queryByRole('menuitem', { name: 'Impostazioni della mappa' })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Elimina mappa' })).not.toBeInTheDocument();
    });

    it('unlocks the map from its settings', async () => {
      const { user } = render();
      await user.click(await menuItem(user, 'Impostazioni della mappa'));
      await user.click(screen.getByRole('switch', { name: /I Player possono modificare la mappa/ }));
      await user.click(screen.getByRole('button', { name: 'Salva' }));
      await vi.waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          '/rooms/room-1/maps/map-1',
          expect.objectContaining({ method: 'PATCH', json: expect.objectContaining({ players_can_edit: true }) }),
        ),
      );
    });

    it('saves from the last revision, one save at a time', async () => {
      wideScreen();
      let answer: (value: unknown) => void = () => {};
      routes.save = () => new Promise((resolve) => (answer = resolve));
      const { user } = render();
      await user.click(await screen.findByRole('button', { name: 'change' }));
      await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvataggio'), { timeout: 2000 });
      await user.click(screen.getByRole('button', { name: 'change' }));
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const saves = () => fetchMock.mock.calls.filter(([path]) => path === '/rooms/room-1/maps/map-1/board');
      expect(saves()).toHaveLength(1);
      expect(saves()[0][1]).toMatchObject({ json: { base_revision: 3 } });

      routes.save = () => Promise.resolve(rawMapDetail({ revision: 5 }));
      answer(rawMapDetail({ revision: 4 }));
      await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvato'));
      expect(saves()).toHaveLength(2);
      expect(saves()[1][1]).toMatchObject({ json: { base_revision: 4 } });
      expect(screen.getByTestId('board')).toHaveTextContent('1 cards');
    });

    it("keeps another editor's card from a save's answer and the editor's own deletion (spec 43)", async () => {
      wideScreen();
      const theirs = rawMapCard({ id: 'card-9', document_id: null, text: 'Il debito di Mira', document: null });
      routes.save = () => Promise.resolve(rawMapDetail({ revision: 5, cards: [...rawMapDetail().cards, theirs] }));
      const { user } = render();
      await user.click(await screen.findByRole('button', { name: 'change' }));
      expect(screen.getByTestId('board')).toHaveTextContent('2 cards');

      await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvato'), { timeout: 2000 });
      // The answer still has card-1 (as mocked) and adds card-9: card-1 stays deleted here.
      expect(screen.getByTestId('board')).toHaveTextContent('3 cards');
      expect(notifyError).not.toHaveBeenCalled();

      // The next save is based on the answer, which (as mocked) still had card-1.
      await user.click(screen.getByRole('button', { name: 'change' }));
      await vi.waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
        '/rooms/room-1/maps/map-1/board',
        expect.objectContaining({ json: expect.objectContaining({ base_revision: 5, deleted_ids: ['card-1', 'card-2'] }) }),
      ), { timeout: 2000 });
    });
  });
});
