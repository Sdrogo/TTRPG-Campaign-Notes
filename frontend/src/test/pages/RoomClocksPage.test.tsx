import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../lib/apiClient';
import { useSession } from '../../hooks/useSession';
import { useRoomEvents } from '../../hooks/useRoomEvents';
import { ViewAsContext } from '../../hooks/useViewAs';
import { fakeSession, rawAccount, rawDocument, rawMember, rawRoom } from '../fixtures';
import { rawClock, rawGroup, rawRules } from '../clockFixtures';
import { renderWithProviders } from '../utils';
import { RoomClocksPage } from '../../pages/RoomClocksPage';

vi.mock('../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../../hooks/useSession', () => ({ useSession: vi.fn() }));
vi.mock('../../hooks/useRoomEvents', () => ({ useRoomEvents: vi.fn(() => 'open') }));

const fetchMock = vi.mocked(apiFetch);
const sessionMock = vi.mocked(useSession);
type SessionState = ReturnType<typeof useSession>;
type Init = { method?: string; json?: unknown } | undefined;

let data: {
  clocks: unknown;
  rules: unknown;
  groups: unknown;
  members: unknown;
  room: unknown;
};
let writes: Record<string, (init: Init) => Promise<unknown>>;

function render(previewing = false) {
  renderWithProviders(
    <Routes>
      <Route path="/rooms/:roomId/clocks" element={<RoomClocksPage />} />
      <Route path="/clocks" element={<RoomClocksPage />} />
    </Routes>,
    {
      route: '/rooms/room-1/clocks',
      wrapper: previewing
        ? ({ children }) => (
            <ViewAsContext.Provider value={{ roomId: 'room-1', userId: 'user-2' }}>{children}</ViewAsContext.Provider>
          )
        : undefined,
    },
  );
  return { user: userEvent.setup() };
}

const asMaster = () => {
  data.members = [rawMember({ user_id: 'user-1', role: 'master', display_name: 'Marco' }), rawMember({ user_id: 'user-2', display_name: 'Giulia' })];
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(useRoomEvents).mockReturnValue('open');
  sessionMock.mockReturnValue({ session: fakeSession('user-1'), loading: false } as SessionState);
  data = {
    clocks: [rawClock()],
    rules: rawRules(),
    groups: [],
    members: [rawMember({ user_id: 'user-1', role: 'player' })],
    room: rawRoom(),
  };
  writes = {};
  fetchMock.mockImplementation((path: string, init?: Init) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    if (writes[key]) return writes[key](init);
    if (init?.method) return Promise.resolve(undefined);
    if (path === '/rooms/room-1/clocks') return Promise.resolve(data.clocks);
    if (path === '/rooms/room-1/clock-rules') return Promise.resolve(data.rules);
    if (path === '/rooms/room-1/clock-groups') return Promise.resolve(data.groups);
    if (path === '/rooms/room-1/members') return Promise.resolve(data.members);
    if (path === '/rooms/room-1') return Promise.resolve(data.room);
    if (path.startsWith('/rooms/room-1/documents')) return Promise.resolve([rawDocument({ id: 'doc-1', name: 'Villa' })]);
    if (path === '/account') return Promise.resolve(rawAccount());
    if (path.includes('/history')) return Promise.resolve({ entries: [], next_before: null });
    return Promise.resolve([]);
  });
});

describe('RoomClocksPage', { timeout: 20_000 }, () => {
  it('waits for the session, then asks to sign in without one', () => {
    sessionMock.mockReturnValue({ session: null, loading: true } as SessionState);
    const { container } = renderWithProviders(
      <Routes>
        <Route path="/rooms/:roomId/clocks" element={<RoomClocksPage />} />
      </Routes>,
      { route: '/rooms/room-1/clocks' },
    );
    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
  });

  it('asks to sign in without a session, and shows nothing without a Room', () => {
    sessionMock.mockReturnValue({ session: null, loading: false } as SessionState);
    render();
    expect(screen.getByText('Accedi per vedere i clock di questa Stanza.')).toBeInTheDocument();
    const { container } = renderWithProviders(
      <Routes>
        <Route path="/clocks" element={<RoomClocksPage />} />
      </Routes>,
      { route: '/clocks' },
    );
    expect(container.querySelector('div')).toBeNull();
  });

  it("shows a Player the Room's clocks, marks one and its legend, with no rules", async () => {
    writes['POST /rooms/room-1/clocks/clock-1/marks'] = () =>
      Promise.resolve({ clock: rawClock({ filled: 5, revision: 4 }), mark_id: 'mark-1' });
    const { user } = render();
    expect(await screen.findByRole('img', { name: 'Allarme: 4 su 8, Aperto' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Clock' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Regole' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuovo clock' })).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Tipi di segno' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Segna un segmento di «Allarme»' }));
    expect(await screen.findByRole('img', { name: 'Allarme: 5 su 8, Aperto' })).toBeInTheDocument();
  });

  it('says when there are no clocks, and when they cannot load', async () => {
    data.clocks = [];
    render();
    expect(await screen.findByText('Nessun clock, per ora.')).toBeInTheDocument();
  });

  it('says when the clocks cannot load', async () => {
    writes['GET /rooms/room-1/clocks'] = () => Promise.reject(new ApiError(500, 'boom'));
    render();
    expect(await screen.findByText('Impossibile caricare i clock.')).toBeInTheDocument();
  });

  it('lets a Player propose a clock under "I giocatori propongono"', async () => {
    data.rules = rawRules({ open_policy: 'propose' });
    const created = vi.fn(() => Promise.resolve(rawClock({ id: 'clock-9', state: 'proposed' })));
    writes['POST /rooms/room-1/clocks'] = created;
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Proponi un clock' }));
    const dialog = await screen.findByRole('dialog', { name: 'Proponi un clock' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Nome' }), 'Fuga');
    await user.click(within(dialog).getByRole('button', { name: 'Proponi' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Proponi un clock' })).not.toBeInTheDocument());
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ json: expect.objectContaining({ name: 'Fuga' }) }));
  });

  it('lets the Master create a clock in the default visibility, and shows a failure in the dialog', async () => {
    asMaster();
    data.room = rawRoom({ default_visibility: 'master' });
    writes['POST /rooms/room-1/clocks'] = () => Promise.reject(new ApiError(400, 'Nome già usato'));
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Nuovo clock' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuovo clock' });
    expect(within(dialog).getByRole('combobox', { name: 'Visibilità' })).toHaveValue('Solo Master (e te)');
    await user.type(within(dialog).getByRole('textbox', { name: 'Nome' }), 'Gilda');
    await user.click(within(dialog).getByRole('button', { name: 'Crea il clock' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Nome già usato');
    await user.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nuovo clock' })).not.toBeInTheDocument());
  });

  it('lets the Master edit, archive, restore and delete a clock', async () => {
    asMaster();
    data.clocks = [
      rawClock({ document: { id: 'doc-1', name: 'Villa' }, selective_user_ids: ['user-2'], visibility: 'selective' }),
      rawClock({ id: 'clock-2', name: 'Vecchio', archived: true }),
    ];
    const patched = vi.fn(() => Promise.resolve(rawClock({ name: 'Allarme rosso' })));
    writes['PATCH /rooms/room-1/clocks/clock-1'] = patched;
    const { user } = render();
    const menu = async (name: string) => user.click(await screen.findByRole('button', { name: `Azioni di «${name}»` }));

    await menu('Allarme');
    await user.click(await screen.findByRole('menuitem', { name: 'Modifica' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifica clock' });
    expect(within(dialog).getByRole('combobox', { name: 'Documento collegato' })).toHaveValue('Villa');
    await user.type(within(dialog).getByRole('textbox', { name: 'Nome' }), ' rosso');
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Modifica clock' })).not.toBeInTheDocument());
    expect(patched).toHaveBeenCalledWith(
      expect.objectContaining({ json: expect.objectContaining({ name: 'Allarme rosso', base_revision: 3 }) }),
    );

    await menu('Allarme');
    await user.click(await screen.findByRole('menuitem', { name: 'Archivia' }));
    await waitFor(() => expect(patched).toHaveBeenLastCalledWith({ method: 'PATCH', json: { archived: true } }));

    await user.click(screen.getByRole('button', { name: /Archiviati/ }));
    await menu('Vecchio');
    await user.click(await screen.findByRole('menuitem', { name: 'Ripristina' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clocks/clock-2', { method: 'PATCH', json: { archived: false } }),
    );

    await menu('Allarme');
    await user.click(await screen.findByRole('menuitem', { name: 'Elimina' }));
    const confirm = await screen.findByRole('dialog', { name: 'Eliminare il clock?' });
    await user.click(within(confirm).getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Eliminare il clock?' })).not.toBeInTheDocument());
    await menu('Allarme');
    await user.click(await screen.findByRole('menuitem', { name: 'Elimina' }));
    const again = await screen.findByRole('dialog', { name: 'Eliminare il clock?' });
    await user.click(within(again).getByRole('button', { name: 'Elimina' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clocks/clock-1', { method: 'DELETE' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Eliminare il clock?' })).not.toBeInTheDocument());
  });

  it("opens a new clock's dialog before the Room and its Documents load", async () => {
    asMaster();
    writes['GET /rooms/room-1'] = () => new Promise(() => {});
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((path: string, init?: Init) =>
      path.startsWith('/rooms/room-1/documents') ? new Promise(() => {}) : original(path, init),
    );
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Nuovo clock' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuovo clock' });
    expect(within(dialog).getByRole('combobox', { name: 'Visibilità' })).toHaveValue('Stanza (tutti i membri)');
  });

  it('opens the rules, the history and "Segna…"', async () => {
    asMaster();
    const marks = vi.fn(() => Promise.resolve({ clock: rawClock({ filled: 6 }), mark_id: 'm' }));
    writes['POST /rooms/room-1/clocks/clock-1/marks'] = marks;
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Regole' }));
    const rules = await screen.findByRole('dialog', { name: 'Regole dei clock' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(rules).not.toBeInTheDocument());

    await user.click(await screen.findByRole('button', { name: 'Azioni di «Allarme»' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Cronologia' }));
    const history = await screen.findByRole('dialog', { name: 'Cronologia di «Allarme»' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(history).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Azioni di «Allarme»' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Segna…' }));
    const mark = await screen.findByRole('dialog', { name: 'Segna «Allarme»' });
    await user.click(within(mark).getByRole('button', { name: 'Segna 1' }));
    await waitFor(() => expect(marks).toHaveBeenCalled());
  });

  it('shows groups as bands and the proposals, which the Master opens, edits or rejects', async () => {
    asMaster();
    data.clocks = [
      rawClock(),
      rawClock({ id: 'clock-2', name: 'Fuori' }),
      rawClock({ id: 'clock-3', name: 'Torre', state: 'proposed', created_by: 'user-2' }),
      rawClock({ id: 'clock-4', name: 'Chiuso', state: 'closed', filled: 8 }),
    ];
    data.groups = [rawGroup({ ended: true }), rawGroup({ id: 'group-2', name: 'Vuoto', clock_ids: ['gone'] })];
    writes['POST /rooms/room-1/clocks/clock-3/open'] = () => Promise.reject(new ApiError(409, 'Già aperto'));
    const { user } = render();
    expect(await screen.findByRole('heading', { name: 'Fuga' })).toBeInTheDocument();
    expect(screen.getAllByText('Gara')).toHaveLength(2);
    expect(screen.getByText('Terminato')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Vuoto' })).getByText('Nessun clock: modifica il gruppo per aggiungerne.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fuori dai gruppi' })).toBeInTheDocument();
    expect(screen.getByText('da Giulia · 8 segmenti')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Apri il clock' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clocks/clock-3/open', { method: 'POST' }));
    await user.click(screen.getByRole('button', { name: 'Rifiuta' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clocks/clock-3', { method: 'DELETE' }));
    await user.click(screen.getByRole('button', { name: 'Apri e modifica' }));
    expect(await screen.findByRole('dialog', { name: 'Modifica clock' })).toBeInTheDocument();

    const finished = screen.getByRole('button', { name: /Chiusi e non avvenuti/ });
    expect(finished).toHaveAttribute('aria-expanded', 'false');
    await user.click(finished);
    expect(finished).toHaveAttribute('aria-expanded', 'true');
  });

  it('lets the Master make a group, edit it, archive and restore it, and delete it', async () => {
    asMaster();
    data.clocks = [rawClock(), rawClock({ id: 'clock-2', name: 'Fuori' })];
    data.groups = [rawGroup({ name: 'Notte', mode: 'free' })];
    writes['POST /rooms/room-1/clock-groups'] = () => Promise.resolve(rawGroup({ id: 'group-9' }));
    writes['PUT /rooms/room-1/clock-groups/group-9/clocks'] = () => Promise.resolve(rawGroup({ id: 'group-9' }));
    writes['PATCH /rooms/room-1/clock-groups/group-1'] = (init) =>
      (init as { json: { name?: string } }).json.name ? Promise.reject(new ApiError(400, 'Nome doppio')) : Promise.resolve(rawGroup());
    const { user } = render();
    const band = await screen.findByRole('region', { name: 'Notte' });
    expect(within(band).getByRole('img', { name: 'Allarme: 4 su 8, Aperto' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nuovo gruppo' }));
    const create = await screen.findByRole('dialog', { name: 'Nuovo gruppo' });
    await user.type(within(create).getByRole('textbox', { name: 'Nome del gruppo' }), 'Fuga');
    await user.click(within(create).getByRole('combobox', { name: 'Clock del gruppo' }));
    await user.click(screen.getByRole('option', { name: 'Fuori' }));
    await user.click(within(create).getByRole('button', { name: 'Salva' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clock-groups/group-9/clocks', {
        method: 'PUT',
        json: { items: [{ clock_id: 'clock-2', decisive_label: null }] },
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nuovo gruppo' })).not.toBeInTheDocument());

    await user.click(within(band).getByRole('button', { name: 'Azioni del gruppo «Notte»' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Modifica' }));
    const edit = await screen.findByRole('dialog', { name: 'Modifica gruppo' });
    expect(within(edit).getByRole('textbox', { name: 'Nome del gruppo' })).toHaveValue('Notte');
    await user.click(within(edit).getByRole('button', { name: 'Salva' }));
    expect(await within(edit).findByRole('alert')).toHaveTextContent('Nome doppio');
    await user.click(within(edit).getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Modifica gruppo' })).not.toBeInTheDocument());

    await user.click(within(band).getByRole('button', { name: 'Azioni del gruppo «Notte»' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archivia il gruppo' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clock-groups/group-1', { method: 'PATCH', json: { archived: true } }),
    );

    await user.click(within(band).getByRole('button', { name: 'Azioni del gruppo «Notte»' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Elimina il gruppo' }));
    const confirm = await screen.findByRole('dialog', { name: 'Eliminare il gruppo?' });
    expect(within(confirm).getByText('«Notte» sparisce; i suoi clock restano, fuori dai gruppi.')).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Eliminare il gruppo?' })).not.toBeInTheDocument());
    await user.click(within(band).getByRole('button', { name: 'Azioni del gruppo «Notte»' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Elimina il gruppo' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Eliminare il gruppo?' })).getByRole('button', { name: 'Elimina' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clock-groups/group-1', { method: 'DELETE' }));
  });

  it('keeps a group whose clocks are all archived under "Archiviati", where the Master restores it', async () => {
    asMaster();
    data.clocks = [rawClock({ archived: true }), rawClock({ id: 'clock-2', name: 'Sciolto', archived: true })];
    data.groups = [rawGroup({ name: 'Notte' })];
    const { user } = render();
    const folded = await screen.findByRole('button', { name: /Archiviati/ });
    expect(within(folded).getByText('2')).toBeInTheDocument();
    await user.click(folded);
    const band = screen.getByRole('region', { name: 'Notte' });
    expect(within(band).getByRole('img', { name: /Allarme/ })).toBeInTheDocument();
    expect(within(band).queryByRole('img', { name: /Sciolto/ })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Sciolto/ })).toBeInTheDocument();
    await user.click(within(band).getByRole('button', { name: 'Azioni del gruppo «Notte»' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Ripristina il gruppo' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clock-groups/group-1', { method: 'PATCH', json: { archived: false } }),
    );
  });

  it("asks the Master to confirm a race, end a turn, start a new one, and reveal a sequence's next clock", async () => {
    asMaster();
    data.clocks = [
      rawClock({ id: 'clock-1', name: 'Fuga', state: 'closed', filled: 8 }),
      rawClock({ id: 'clock-2', name: 'Lente', state: 'closed', filled: 8, decisive_label: 'Salva' }),
      rawClock({ id: 'clock-3', name: 'Rito' }),
      rawClock({ id: 'clock-4', name: 'Primo', state: 'closed', filled: 8 }),
      rawClock({ id: 'clock-5', name: 'Secondo', visibility: 'master' }),
      rawClock({ id: 'clock-6', name: 'Altro' }),
    ];
    data.groups = [
      rawGroup({ name: 'Gara', clock_ids: ['clock-1', 'clock-6'], pending_ids: ['clock-1'] }),
      rawGroup({ id: 'group-2', name: 'Notte', mode: 'turn', clock_ids: ['clock-2', 'clock-3'], pending_ids: ['clock-2'] }),
      rawGroup({ id: 'group-3', name: 'Scale', mode: 'sequence', clock_ids: ['clock-4', 'clock-5'] }),
      rawGroup({
        id: 'group-4',
        name: 'Ieri',
        mode: 'turn',
        clock_ids: ['clock-6'],
        ended: true,
        result: { outcomes: [{ clock_id: 'clock-6', label: 'Fatto' }] },
      }),
    ];
    writes['POST /rooms/room-1/clock-groups/group-1/end'] = () => Promise.reject(new ApiError(409, 'Già terminato'));
    const { user } = render();
    const race = await screen.findByRole('region', { name: 'Gara' });
    expect(within(race).getByRole('status')).toHaveTextContent('«Fuga» si è chiuso per primo.');
    await user.click(within(race).getByRole('button', { name: 'Conferma' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clock-groups/group-1/end', { method: 'POST' }));
    await user.click(within(race).getByRole('button', { name: 'Non ancora' }));
    expect(within(race).queryByRole('status')).not.toBeInTheDocument();

    const turn = screen.getByRole('region', { name: 'Notte' });
    expect(within(turn).getByRole('status')).toHaveTextContent('La svolta termina: «Lente» (Salva).');
    await user.click(within(turn).getByRole('button', { name: 'Termina la svolta' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clock-groups/group-2/end', { method: 'POST' }));

    const sequence = screen.getByRole('region', { name: 'Scale' });
    expect(within(sequence).getByRole('status')).toHaveTextContent('«Secondo» è il prossimo');
    await user.click(within(sequence).getByRole('button', { name: 'Rivela alla Stanza' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clocks/clock-5', { method: 'PATCH', json: { visibility: 'room' } }),
    );

    const past = screen.getByRole('region', { name: 'Ieri' });
    expect(within(past).getByText('Svolta: Fatto')).toBeInTheDocument();
    await user.click(within(past).getByRole('button', { name: 'Azioni del gruppo «Ieri»' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Nuova svolta' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuovo gruppo' });
    expect(within(dialog).getByRole('textbox', { name: 'Nome del gruppo' })).toHaveValue('Ieri');
  });

  it("shows a Player the proposals without the Master's buttons", async () => {
    data.clocks = [rawClock({ state: 'proposed', created_by: 'gone' })];
    render();
    expect(await screen.findByText('da Utente sconosciuto · 8 segmenti')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apri il clock' })).not.toBeInTheDocument();
  });

  it('shows the Master viewing as a Player a read-only page', async () => {
    asMaster();
    const { user } = render(true);
    expect(await screen.findByRole('img', { name: 'Allarme: 4 su 8, Aperto' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Regole' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuovo clock' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Segna un segmento di «Allarme»' }));
    expect(fetchMock).not.toHaveBeenCalledWith('/rooms/room-1/clocks/clock-1/marks', expect.anything());
  });
});
