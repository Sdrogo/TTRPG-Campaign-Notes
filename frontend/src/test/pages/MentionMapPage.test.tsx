import { screen } from '@testing-library/react';
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
import { MentionMapPage } from '../../pages/MentionMapPage';

vi.mock('../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../../hooks/useSession', () => ({ useSession: vi.fn() }));

// The board has its own tests: here it reports how it was drawn and moves the
// second card when asked.
vi.mock('../../components/maps/MapBoard', () => ({
  MapBoard: ({
    board,
    editable,
    mode,
    onChange,
  }: {
    board: Board;
    editable: boolean;
    mode: string;
    onChange: (board: Board) => void;
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

  it("keeps the user's own moves while a newer map arrives before they are saved", async () => {
    wideScreen();
    const queryClient = createTestQueryClient();
    const key = ['rooms', 'room-1', 'documents', 'doc-1', 'mentionMap'];
    const newer = toMentionMap(rawMentionMap({ cards: [] }) as Parameters<typeof toMentionMap>[0]);
    let finishSave: (value: unknown) => void = () => undefined;
    saveCards = () => new Promise((resolve) => (finishSave = resolve));
    const { user } = render(false, `${DOC}/mention-map`, queryClient);
    await user.click(await screen.findByRole('button', { name: 'move' }));
    queryClient.setQueryData(key, { ...newer });
    expect(await screen.findByTestId('board')).toHaveTextContent('card-2@999');

    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvataggio'), { timeout: 2000 });
    queryClient.setQueryData(key, { ...newer });
    expect(await screen.findByTestId('board')).toHaveTextContent('card-2@999');
    finishSave(rawMentionMap());
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvato'));
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
});
