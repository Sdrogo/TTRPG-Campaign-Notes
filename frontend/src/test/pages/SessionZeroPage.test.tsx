import { act, screen, within } from '@testing-library/react';
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
import { useSessionZeroEvents } from '../../hooks/useSessionZeroEvents';

vi.mock('../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../../hooks/useSession', () => ({ useSession: vi.fn() }));
vi.mock('../../hooks/useSessionZeroEvents', () => ({ useSessionZeroEvents: vi.fn() }));
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
  vi.mocked(useSessionZeroEvents).mockReturnValue(new Set());
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
    // Spec 46c Decision 10: a handle between the two boards resizes them.
    expect(screen.getByRole('separator', { name: 'Ridimensiona Linee e Veli' })).toBeInTheDocument();
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
    expect(await screen.findByText('Chiusa')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aggiungi post-it' })).not.toBeInTheDocument();

    // Spec 46_4: another member deleted the Session 0, so the open round comes back.
    board = () => Promise.resolve(rawSessionZero({ rounds, round_id: 'round-2' }));
    const onReset = vi.mocked(useSessionZeroEvents).mock.calls.at(-1)![1];
    act(() => onReset());
    expect(await screen.findAllByRole('button', { name: 'Aggiungi post-it' })).not.toHaveLength(0);
  });

  // Spec 46_4: what another member just changed glows.
  it('makes what another member changed glow', async () => {
    vi.mocked(useSessionZeroEvents).mockReturnValue(new Set(['card-1']));
    board = () => Promise.resolve(rawSessionZero({ retro: [rawPostItColumn({ cards: [rawPostIt()] })] }));
    render();
    const card = (await screen.findByText('Niente ragni')).closest('.sz-post-it');
    expect(card).toHaveAttribute('data-glow', 'true');
    expect(useSessionZeroEvents).toHaveBeenCalledWith('room-1', expect.any(Function));
  });

  // Spec 46c Decision 8: all the viewer's drafts of the open round at once.
  it('publishes all the viewer\'s drafts at once', async () => {
    const drafts = [
      rawPostIt({ id: 'd1', draft: true, can_publish: true }),
      rawPostIt({ id: 'd2', draft: true, can_publish: true }),
    ];
    board = () => Promise.resolve(rawSessionZero({ retro: [rawPostItColumn({ cards: drafts })] }));
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Pubblica bozze (2)' }));
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
    expect(screen.queryByRole('button', { name: /Pubblica bozze/ })).not.toBeInTheDocument();
  });

  it('says which drafts stay drafts past the board\'s limit, and cancels', async () => {
    // Bare post-its (no menu, no reactions) keep the 199 quick to render.
    const bare = { mine: false, can_edit: false, can_delete: false, can_react: false };
    const published = Array.from({ length: 199 }, (_, i) => rawPostIt({ ...bare, id: `p${i}` }));
    const drafts = Array.from({ length: 3 }, (_, i) => rawPostIt({ id: `d${i}`, draft: true, can_publish: true }));
    board = () => Promise.resolve(rawSessionZero({ retro: [rawPostItColumn({ cards: [...published, ...drafts] })] }));
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Pubblica bozze (3)' }));
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
  // Spec 47 Decision 2: the Master composes the first session's chain.
  it('lets the Master compose the chain when starting', async () => {
    board = () =>
      Promise.resolve(rawSessionZero({ started: false, can_manage: true, rounds: [], round_id: null, retro: [], lines_veils: [] }));
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Avvia la Sessione 0' }));
    const dialog = await screen.findByRole('dialog', { name: 'Avvia la Sessione 0' });
    await user.click(within(dialog).getAllByRole('button', { name: 'Rimuovi' })[1]);
    await user.click(within(dialog).getByRole('combobox', { name: 'Tappa' }));
    await user.click(await screen.findByRole('option', { name: 'Stelle e Desideri' }));
    await user.click(within(dialog).getByRole('button', { name: 'Aggiungi tappa' }));
    await user.click(within(dialog).getAllByRole('button', { name: 'Sposta su' })[1]);
    await user.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Avvia la Sessione 0' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Avvia' }));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/session-zero/start', {
      method: 'POST',
      json: { modules: ['stars_wishes', 'retro'] },
    });
  });

  // Spec 47 Decisions 4, 5 and 7: each step shows its own board; the table's move brings every page along.
  it('opens each step of the chain and follows the table', async () => {
    restoreMedia = matchMediaQueries(['(min-width: 62em)']);
    const modules = [
      { id: 'module-retro', kind: 'retro', position: 0, columns: [rawPostItColumn({ cards: [rawPostIt()] })] },
      {
        id: 'module-sw',
        kind: 'stars_wishes',
        position: 1,
        columns: [
          rawPostItColumn({ id: 'sw-stars', kind: 'stars', title: '', color: 'gold' }),
          rawPostItColumn({ id: 'sw-wishes', kind: 'wishes', title: '', color: 'blue' }),
        ],
      },
      { id: 'module-lv', kind: 'lines_veils', position: 2, columns: [] },
    ];
    board = () => Promise.resolve(rawSessionZero({ can_manage: true, modules }));
    const { user } = render();
    const nav = await screen.findByRole('navigation', { name: 'Tappe' });
    expect(screen.getByRole('region', { name: 'Retro' })).toBeInTheDocument();

    await user.click(within(nav).getByRole('button', { name: '2. Stelle e Desideri' }));
    const starsWishes = screen.getByRole('region', { name: 'Stelle e Desideri' });
    expect(within(starsWishes).getByRole('heading', { name: 'Stelle' })).toBeInTheDocument();
    expect(within(starsWishes).getByRole('heading', { name: 'Desideri' })).toBeInTheDocument();
    expect(within(starsWishes).queryByRole('button', { name: /Azioni della colonna/ })).not.toBeInTheDocument();
    expect(within(starsWishes).queryByRole('button', { name: 'Aggiungi colonna' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Linee e Veli' })).not.toBeInTheDocument();

    await user.click(within(nav).getByRole('button', { name: '3. Linee e Veli' }));
    expect(screen.getByRole('region', { name: 'Linee e Veli' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Retro' })).not.toBeInTheDocument();

    // The Master brings the table to Stars and Wishes: every page goes there.
    write = () => Promise.resolve(rawSessionZero({ can_manage: true, modules, current_module_id: 'module-sw' }));
    await user.click(within(nav).getByRole('button', { name: '2. Stelle e Desideri' }));
    await user.click(within(nav).getByRole('button', { name: 'Porta qui il tavolo' }));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/session-zero/modules/current', {
      method: 'PUT',
      json: { module_id: 'module-sw' },
    });
    await vi.waitFor(() =>
      expect(within(nav).getByRole('button', { name: '2. Stelle e Desideri' })).toHaveAttribute('aria-current', 'step'),
    );
    await user.click(within(nav).getByRole('button', { name: '1. Retro' }));
    expect(screen.getByRole('region', { name: 'Retro' })).toBeInTheDocument();
    await user.click(within(nav).getByRole('button', { name: '2. Stelle e Desideri' }));
    expect(screen.getByRole('region', { name: 'Stelle e Desideri' })).toBeInTheDocument();
  });

  // Spec 47_2: a Questions step shows its questions, with the Room's Tags.
  it('shows a Questions step', async () => {
    const questions = {
      tag_id: null,
      answers_revealed: false,
      players_bypass_creation_rule: true,
      questions: [{ id: 'q-1', position: 0, body: 'Come ti chiami?', hint: null, target: 'name', tag_id: null }],
      answers: [],
      documents: [],
      can_create: false,
      creatable: 0,
    };
    board = () =>
      Promise.resolve(
        rawSessionZero({
          modules: [{ id: 'module-q', kind: 'questions', position: 0, columns: [], questions }],
          current_module_id: 'module-q',
        }),
      );
    // The Tags come later than the boards.
    const others = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((path: string, init?: { method?: string }) =>
      path === '/rooms/room-1/tags' ? new Promise(() => {}) : others(path, init),
    );
    render();
    const section = await screen.findByRole('region', { name: 'Domande' });
    expect(within(section).getByRole('textbox', { name: 'Come ti chiami?' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Retro' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags');
  });

  it('goes back to the current step when another session is picked', async () => {
    const rounds = [
      { id: 'round-1', number: 1, title: null, started_at: '2026-10-01T09:00:00Z', closed_at: '2026-10-20T09:00:00Z' },
      { id: 'round-2', number: 2, title: null, started_at: '2026-10-20T09:00:00Z', closed_at: null },
    ];
    const modules = [
      { id: 'module-retro', kind: 'retro', position: 0, columns: [rawPostItColumn()] },
      { id: 'module-lv', kind: 'lines_veils', position: 1, columns: [] },
    ];
    board = () => Promise.resolve(rawSessionZero({ rounds, round_id: 'round-2', modules }));
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: '2. Linee e Veli' }));
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Sessione da mostrare' }));
    board = () => Promise.resolve(rawSessionZero({ rounds, round_id: 'round-1' }));
    await user.click(await screen.findByRole('option', { name: 'Sessione 0' }));
    expect(await screen.findByRole('tab', { name: 'Retro' })).toBeInTheDocument();
  });

  // Spec 47: "Publish drafts" counts the drafts of every step of the open session.
  it('counts the drafts of every step', async () => {
    const draft = (id: string) => rawPostIt({ id, draft: true, can_publish: true });
    const modules = [
      { id: 'module-retro', kind: 'retro', position: 0, columns: [rawPostItColumn({ cards: [draft('d1')] })] },
      {
        id: 'module-sw',
        kind: 'stars_wishes',
        position: 1,
        columns: [rawPostItColumn({ id: 'sw-stars', kind: 'stars', title: '', cards: [draft('d2'), draft('d3')] })],
      },
    ];
    board = () => Promise.resolve(rawSessionZero({ modules }));
    render();
    expect(await screen.findByRole('button', { name: 'Pubblica bozze (3)' })).toBeInTheDocument();
  });
});
