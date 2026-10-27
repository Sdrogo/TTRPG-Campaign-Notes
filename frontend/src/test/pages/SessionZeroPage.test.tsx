import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../lib/apiClient';
import { notifyError } from '../../lib/notify';
import { useSession } from '../../hooks/useSession';
import { ViewAsContext } from '../../hooks/useViewAs';
import { fakeSession, rawAccount, rawMember, rawPostIt, rawPostItColumn, rawSessionZero } from '../fixtures';
import { matchMediaQueries } from '../media';
import { renderWithProviders } from '../utils';
import { SessionZeroPage } from '../../pages/SessionZeroPage';

vi.mock('../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../../hooks/useSession', () => ({ useSession: vi.fn() }));
vi.mock('../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);
const sessionMock = vi.mocked(useSession);
type SessionState = ReturnType<typeof useSession>;

let board: () => Promise<unknown>;
let write: () => Promise<unknown>;
let restoreMedia: (() => void) | null = null;

function render(previewing = false) {
  renderWithProviders(
    <Routes>
      <Route path="/rooms/:roomId/session-zero" element={<SessionZeroPage />} />
    </Routes>,
    {
      route: '/rooms/room-1/session-zero',
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
  vi.mocked(notifyError).mockReset();
  board = () => Promise.resolve(rawSessionZero());
  write = () => Promise.resolve(rawSessionZero());
  sessionMock.mockReturnValue({ session: fakeSession('user-1'), loading: false } as SessionState);
  fetchMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path.startsWith('/rooms/room-1/session-zero') && init?.method) return write();
    if (path.startsWith('/rooms/room-1/session-zero')) return board();
    if (path === '/rooms/room-1/members') return Promise.resolve([rawMember()]);
    if (path === '/account') return Promise.resolve(rawAccount());
    return Promise.resolve([]);
  });
});

afterEach(() => {
  restoreMedia?.();
  restoreMedia = null;
});

describe('SessionZeroPage', () => {
  it('waits for the session', () => {
    sessionMock.mockReturnValue({ session: null, loading: true } as SessionState);
    render();
    expect(document.querySelector('.mantine-Loader-root')).toBeInTheDocument();
  });

  it('asks to sign in without a session', () => {
    sessionMock.mockReturnValue({ session: null, loading: false } as SessionState);
    render();
    expect(screen.getByText('Accedi per vedere la Sessione 0 di questa Stanza.')).toBeInTheDocument();
  });

  it('renders nothing without a Room in the URL', () => {
    renderWithProviders(<SessionZeroPage />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says when the boards cannot be read', async () => {
    board = () => Promise.reject(new ApiError(500, 'boom'));
    render();
    expect(await screen.findByText('Impossibile caricare la Sessione 0.')).toBeInTheDocument();
  });

  // Decision 10: the first member to open it starts the Room's Session 0.
  it('starts a Session 0 not started yet', async () => {
    board = () => Promise.resolve(rawSessionZero({ started: false, rounds: [], round_id: null, retro: [], lines_veils: [] }));
    const { user } = render();
    expect(await screen.findByText(/non è ancora iniziata/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Avvia la Sessione 0' }));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/session-zero/start', { method: 'POST', json: undefined });
    expect(await screen.findByRole('tab', { name: 'Retro' })).toBeInTheDocument();
  });

  it('starts nothing while the Master previews the Room', async () => {
    board = () => Promise.resolve(rawSessionZero({ started: false, rounds: [], round_id: null, retro: [], lines_veils: [] }));
    render(true);
    expect(await screen.findByText(/non è ancora iniziata/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Avvia la Sessione 0' })).not.toBeInTheDocument();
  });

  // Decision 13: on a phone the two boards are two tabs.
  it('shows the boards as two tabs on a phone', async () => {
    const { user } = render();
    expect(await screen.findByRole('article', { name: 'Post-it di Tu' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Must' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Linee e Veli' }));
    expect(await screen.findByRole('heading', { name: 'Must' })).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('shows the boards before the members load', async () => {
    board = () =>
      Promise.resolve(rawSessionZero({ retro: [rawPostItColumn({ cards: [rawPostIt({ author_id: 'user-2', mine: false })] })] }));
    fetchMock.mockImplementation((path: string) =>
      path === '/rooms/room-1/members' ? new Promise(() => {}) : board(),
    );
    render();
    expect(await screen.findByRole('article', { name: 'Post-it di Utente sconosciuto' })).toBeInTheDocument();
  });

  it('shows the Retro board beside Lines & Veils on a wide screen, with the timer on top', async () => {
    restoreMedia = matchMediaQueries(['(min-width: 62em)']);
    board = () =>
      Promise.resolve(
        rawSessionZero({
          can_manage: true,
          timer: { state: 'paused', duration_s: 300, ends_at: null, remaining_s: 65, now: '2026-10-27T10:00:00Z' },
        }),
      );
    render();
    const retro = await screen.findByRole('region', { name: 'Retro' });
    expect(within(retro).getByRole('article')).toBeInTheDocument();
    expect(within(retro).getByRole('button', { name: 'Aggiungi colonna' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Linee e Veli' })).getByRole('heading', { name: 'Veli' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('1:05');
  });

  // Decision 12: at most 8 Retro columns.
  it('offers no new column once the round has 8', async () => {
    restoreMedia = matchMediaQueries(['(min-width: 62em)']);
    const retro = Array.from({ length: 8 }, (_, i) => rawPostItColumn({ id: `col-${i}`, title: `Colonna ${i}` }));
    board = () => Promise.resolve(rawSessionZero({ can_manage: true, retro }));
    render();
    expect(await screen.findByRole('heading', { name: 'Colonna 7' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aggiungi colonna' })).not.toBeInTheDocument();
  });

  it('sends a write and shows a failed one as an error', async () => {
    write = () => Promise.reject(new ApiError(409, 'Già promosso'));
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Azioni del post-it' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Elimina' }));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/session-zero/cards/card-1', { method: 'DELETE', json: undefined });
    await vi.waitFor(() => expect(notifyError).toHaveBeenCalled());
  });

  // Decision 16: a closed round is read again by its id, read-only.
  it('shows a closed round picked from the selector', async () => {
    const rounds = [
      { id: 'round-1', number: 1, title: null, started_at: '2026-10-01T09:00:00Z', closed_at: '2026-10-20T09:00:00Z' },
      { id: 'round-2', number: 2, title: null, started_at: '2026-10-20T09:00:00Z', closed_at: null },
    ];
    board = () => Promise.resolve(rawSessionZero({ rounds, round_id: 'round-2' }));
    const { user } = render();
    await user.click(await screen.findByRole('combobox', { name: 'Sessione da mostrare' }));
    board = () => Promise.resolve(rawSessionZero({ rounds, round_id: 'round-1' }));
    await user.click(await screen.findByRole('option', { name: 'Sessione 0' }));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/session-zero?round_id=round-1');
    expect(await screen.findByText('Questa sessione è chiusa: la lavagna è in sola lettura.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aggiungi post-it' })).not.toBeInTheDocument();
  });

  // Spec 46c Decision 8: all the viewer's drafts of the open round at once.
  it('publishes all the viewer\'s drafts at once', async () => {
    const drafts = [
      rawPostIt({ id: 'd1', draft: true, can_publish: true }),
      rawPostIt({ id: 'd2', draft: true, can_publish: true }),
    ];
    board = () => Promise.resolve(rawSessionZero({ retro: [rawPostItColumn({ cards: drafts })] }));
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Pubblica tutte le bozze (2)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pubblica tutte le tue bozze' });
    expect(dialog).toHaveTextContent('Le tue 2 bozze di questo giro');
    expect(dialog).not.toHaveTextContent('quasi piena');
    await user.click(within(dialog).getByRole('switch', { name: /Pubblica in anonimo/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Pubblica' }));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/session-zero/cards/publish-all', {
      method: 'POST',
      json: { anonymous: true },
    });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Pubblica tutte le bozze/ })).not.toBeInTheDocument();
  });

  it('says which drafts stay drafts past the board\'s limit, and cancels', async () => {
    // Bare post-its (no menu, no reactions) keep the 199 quick to render.
    const bare = { mine: false, can_edit: false, can_delete: false, can_react: false };
    const published = Array.from({ length: 199 }, (_, i) => rawPostIt({ ...bare, id: `p${i}` }));
    const drafts = Array.from({ length: 3 }, (_, i) => rawPostIt({ id: `d${i}`, draft: true, can_publish: true }));
    board = () => Promise.resolve(rawSessionZero({ retro: [rawPostItColumn({ cards: [...published, ...drafts] })] }));
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Pubblica tutte le bozze (3)' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('La bacheca è quasi piena: 2 bozze restano bozze.');
    await user.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    expect(fetchMock).not.toHaveBeenCalledWith('/rooms/room-1/session-zero/cards/publish-all', expect.anything());
  }, 20_000);

  // Spec 46c Decision 3: once deleted the page is "not started" again, showing the open round.
  it('goes back to "not started" once the Master deletes the Session 0', async () => {
    board = () => Promise.resolve(rawSessionZero({ can_manage: true }));
    write = () => Promise.resolve(rawSessionZero({ started: false, rounds: [], round_id: null, retro: [], lines_veils: [] }));
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Azioni della Sessione 0' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Elimina Sessione 0' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Elimina' }));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/session-zero', { method: 'DELETE', json: undefined });
    expect(await screen.findByText(/non è ancora iniziata/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Sessione 0' })).toBeInTheDocument();
  });
});
