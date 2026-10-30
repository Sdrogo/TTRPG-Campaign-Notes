import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../lib/apiClient';
import { useSession } from '../../hooks/useSession';
import { ViewAsContext } from '../../hooks/useViewAs';
import type { Board } from '../../types/map';
import { fakeSession, rawDocument, rawMentionMap } from '../fixtures';
import { createTestQueryClient, renderWithProviders } from '../utils';
import { toMentionMap } from '../../lib/maps';
import type { RoomEvent } from '../../lib/roomEvents';
import { MentionMapPage } from '../../pages/MentionMapPage';

vi.mock('../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../../hooks/useSession', () => ({ useSession: vi.fn() }));

// The Room stream (spec 52): open at once, its events sent by the tests.
const stream: { send?: (event: RoomEvent) => void } = {};
vi.mock('../../lib/roomEvents', () => ({
  readRoomEvents: vi.fn((_roomId: string, _signal: AbortSignal, onOpen: () => void, onEvent: (event: RoomEvent) => void) => {
    stream.send = onEvent;
    onOpen();
    return new Promise<void>(() => {});
  }),
}));

// The board has its own tests: here it reports how it was drawn and moves the
// second card when asked.
vi.mock('../../components/maps/MapBoard', () => ({
  MapBoard: ({
    board,
    editable,
    mode,
    onChange,
    onSelectDocument,
  }: {
    board: Board;
    editable: boolean;
    mode: string;
    onChange: (board: Board) => void;
    onSelectDocument?: (documentId: string) => void;
  }) => (
    <div data-testid="board" data-editable={String(editable)} data-mode={mode}>
      {board.cards.map((card) => `${card.id}@${card.x}`).join(' ')}
      <button
        type="button"
        onClick={() =>
          onChange({ ...board, cards: board.cards.map((card, i) => (i === 1 ? { ...card, x: 999 } : card)) })
        }
      >
        move
      </button>
      <button
        type="button"
        onClick={() =>
          onChange({ ...board, cards: board.cards.map((card, i) => (i === 0 ? { ...card, x: 555 } : card)) })
        }
      >
        move first
      </button>
      {onSelectDocument && (
        <button type="button" onClick={() => onSelectDocument('doc-9')}>
          select
        </button>
      )}
    </div>
  ),
}));

const fetchMock = vi.mocked(apiFetch);
const sessionMock = vi.mocked(useSession);
type SessionState = ReturnType<typeof useSession>;
type Init = { method?: string; json?: unknown };
const DOC = '/rooms/room-1/documents/doc-1';

let map: () => Promise<unknown>;
let saveCards: () => Promise<unknown>;
let document_: () => Promise<unknown>;
const originalMatchMedia = window.matchMedia;

function wideScreen() {
  window.matchMedia = ((query: string) => ({
    ...originalMatchMedia(query),
    matches: true,
  })) as typeof window.matchMedia;
}

function render(previewing = false, route = `${DOC}/mention-map`, queryClient = createTestQueryClient()) {
  renderWithProviders(
    <Routes>
      <Route path="/rooms/:roomId/documents/:documentId/mention-map" element={<MentionMapPage />} />
      <Route path="/rooms/:roomId/mention-map" element={<MentionMapPage />} />
    </Routes>,
    {
      route,
      queryClient,
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
  map = () => Promise.resolve(rawMentionMap());
  saveCards = () => Promise.resolve(rawMentionMap());
  document_ = () => Promise.resolve(rawDocument({ name: 'Mira' }));
  sessionMock.mockReturnValue({ session: fakeSession('user-1'), loading: false } as SessionState);
  fetchMock.mockImplementation((path: string, init?: Init) => {
    if (path === `${DOC}/mention-map/cards`) return saveCards();
    if (path.startsWith(`${DOC}/mention-map/preview`)) {
      return Promise.resolve({ documents: 1, relations: 1, documents_left_out: 0 });
    }
    if (path === `${DOC}/mention-map` && init?.method === 'PATCH') {
      return Promise.resolve(rawMentionMap({ depth: 1, documents_left_out: 0, cards: [] }));
    }
    if (path === `${DOC}/mention-map`) return map();
    if (path === DOC) return document_();
    return Promise.resolve([]);
  });
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('MentionMapPage', () => {
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

  it('renders nothing without a Document in the URL', () => {
    render(false, '/rooms/room-1/mention-map');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says when the Document has no map, or it cannot be loaded', async () => {
    map = () => Promise.reject(new ApiError(404, 'No map'));
    render();
    expect(await screen.findByText('Mappa non trovata.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Torna al Documento' })).toHaveAttribute('href', DOC);
  });

  it('says when the map failed to load', async () => {
    map = () => Promise.reject(new ApiError(500, 'Rotto'));
    render();
    expect(await screen.findByText('Impossibile caricare la mappa delle menzioni.')).toBeInTheDocument();
  });

  it('says when the Document failed to load', async () => {
    document_ = () => Promise.reject(new ApiError(404, 'No doc'));
    render();
    expect(await screen.findByText('Mappa non trovata.')).toBeInTheDocument();
  });

  it('shows the map read-only on a phone, with the cap notice', async () => {
    map = () => Promise.resolve(rawMentionMap({ documents_left_out: 3 }));
    render();
    expect(await screen.findByRole('heading', { name: 'Mira' })).toBeInTheDocument();
    expect(screen.getByText(/sola lettura/)).toBeInTheDocument();
    expect(screen.getByText(/150 carte: 3/)).toBeInTheDocument();
    expect(screen.getByTestId('board')).toHaveAttribute('data-editable', 'false');
    expect(screen.getByTestId('board')).toHaveAttribute('data-mode', 'mention');
  });

  it('saves a moved card shortly after and says so', async () => {
    wideScreen();
    const { user } = render();
    const board = await screen.findByTestId('board');
    expect(board).toHaveAttribute('data-editable', 'true');
    await user.click(screen.getByRole('button', { name: 'move' }));
    expect(screen.getByRole('status')).toHaveTextContent('Modifiche non salvate');
    expect(board).toHaveTextContent('card-2@999');
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvato'), { timeout: 2000 });
    expect(fetchMock).toHaveBeenCalledWith(`${DOC}/mention-map/cards`, {
      method: 'PUT',
      json: { cards: [{ document_id: 'doc-2', x: 999, y: 0, color: 'default' }] },
    });
  });

  it('shows why a save failed and retries it', async () => {
    wideScreen();
    saveCards = () => Promise.reject(new ApiError(404, 'Non sulla mappa'));
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'move' }));
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Non sulla mappa'), {
      timeout: 2000,
    });
    saveCards = () => Promise.resolve(rawMentionMap());
    await user.click(screen.getByRole('button', { name: 'Riprova' }));
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvato'));
  });

  it('falls back to a generic message when a save fails without one', async () => {
    wideScreen();
    saveCards = () => Promise.reject(new ApiError(500, ''));
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'move' }));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Riprova' })).toBeInTheDocument(), {
      timeout: 2000,
    });
  });

  it("keeps the user's own moves while someone else's arrive before they are saved", async () => {
    wideScreen();
    const queryClient = createTestQueryClient();
    const key = ['rooms', 'room-1', 'documents', 'doc-1', 'mentionMap'];
    const raw = rawMentionMap();
    // The other manager moved the first card.
    const theirs = { ...raw, revision: 2, cards: [{ ...raw.cards[0], x: 77 }, raw.cards[1]] };
    let finishSave: (value: unknown) => void = () => undefined;
    saveCards = () => new Promise((resolve) => (finishSave = resolve));
    const { user } = render(false, `${DOC}/mention-map`, queryClient);
    await user.click(await screen.findByRole('button', { name: 'move' }));
    act(() => queryClient.setQueryData(key, toMentionMap(theirs as Parameters<typeof toMentionMap>[0])));
    await vi.waitFor(() => expect(screen.getByTestId('board')).toHaveTextContent('card-1@77 card-2@999'));

    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvataggio'), { timeout: 2000 });
    expect(fetchMock).toHaveBeenCalledWith(`${DOC}/mention-map/cards`, {
      method: 'PUT',
      json: { cards: [{ document_id: 'doc-2', x: 999, y: 0, color: 'default' }] },
    });
    await act(async () => finishSave({ ...theirs, revision: 3, cards: [theirs.cards[0], { ...raw.cards[1], x: 999 }] }));
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvato'));
    expect(screen.getByTestId('board')).toHaveTextContent('card-1@77 card-2@999');
  });

  it('keeps a move made while the previous one is being saved', async () => {
    wideScreen();
    const queryClient = createTestQueryClient();
    const raw = rawMentionMap();
    const answers: ((value: unknown) => void)[] = [];
    saveCards = () => new Promise((resolve) => answers.push(resolve));
    const { user } = render(false, `${DOC}/mention-map`, queryClient);
    await user.click(await screen.findByRole('button', { name: 'move' }));
    await vi.waitFor(() => expect(answers).toHaveLength(1), { timeout: 2000 });

    // A second move while the first save is on its way, then its answer
    // (without the second move) lands, then the Document is read again.
    await user.click(screen.getByRole('button', { name: 'move first' }));
    await act(async () => answers[0]({ ...raw, revision: 2, cards: [raw.cards[0], { ...raw.cards[1], x: 999 }] }));
    expect(screen.getByTestId('board')).toHaveTextContent('card-1@555 card-2@999');
    act(() => stream.send?.({ topic: 'document', revision: null, kind: 'changed', id: 'doc-9' }));
    await vi.waitFor(() => expect(answers).toHaveLength(2), { timeout: 2000 });
    expect(screen.getByTestId('board')).toHaveTextContent('card-1@555 card-2@999');
    expect(fetchMock).toHaveBeenLastCalledWith(`${DOC}/mention-map/cards`, {
      method: 'PUT',
      json: { cards: [{ document_id: 'doc-1', x: 555, y: 0, color: 'gold' }] },
    });
  });

  it("redraws the map when another manager saves it, and says when it's gone", async () => {
    wideScreen();
    render();
    expect(await screen.findByTestId('board')).toHaveTextContent('card-2@400');
    map = () => Promise.resolve(rawMentionMap({ revision: 2, cards: [rawMentionMap().cards[0]] }));
    act(() => stream.send?.({ topic: 'map', revision: 1, kind: 'changed', id: 'mention-map-1' }));
    act(() => stream.send?.({ topic: 'map', revision: 2, kind: 'changed', id: 'other-map' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId('board')).toHaveTextContent('card-2@400');

    act(() => stream.send?.({ topic: 'map', revision: 2, kind: 'changed', id: 'mention-map-1' }));
    await vi.waitFor(() => expect(screen.getByTestId('board')).not.toHaveTextContent('card-2'));
    act(() => stream.send?.({ topic: 'map', revision: 3, kind: 'deleted', id: 'mention-map-1' }));
    expect(await screen.findByText(/non trovata|not found/i)).toBeInTheDocument();
  });

  it('opens the settings to its manager, and redraws after a depth change', async () => {
    const { user } = render();
    expect(await screen.findByTestId('board')).toHaveTextContent('card-2@400');
    await user.click(await screen.findByRole('button', { name: 'Impostazioni della mappa' }));
    expect(await screen.findByRole('button', { name: 'Copia come mappa libera' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await vi.waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Copia come mappa libera' })).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Impostazioni della mappa' }));
    await user.click(screen.getByRole('radio', { name: '1' }));
    await screen.findByRole('status');
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    await vi.waitFor(() => expect(screen.getByTestId('board')).not.toHaveTextContent('card-2'));
  });

  it('offers no editing in a preview, nor to whoever cannot manage it', async () => {
    wideScreen();
    render(true);
    expect(await screen.findByTestId('board')).toHaveAttribute('data-editable', 'false');
    expect(screen.queryByRole('button', { name: 'Impostazioni della mappa' })).not.toBeInTheDocument();
    expect(screen.queryByText(/sola lettura/)).not.toBeInTheDocument();
  });

  it('splits the screen with a button, and a click on a card shows its Document (spec 37)', async () => {
    wideScreen();
    const { user } = render(false, `${DOC}/mention-map`);
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
});
