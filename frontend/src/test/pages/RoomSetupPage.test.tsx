import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { notifyError, notifySuccess } from '../../lib/notify';
import { useSession } from '../../hooks/useSession';
import { fakeSession, rawAccount, rawHistoryEntry, rawMember, rawRoom } from '../fixtures';
import { renderWithProviders } from '../utils';
import { RoomMembersRedirect, RoomSetupPage } from '../../pages/RoomSetupPage';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../lib/notify', () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));
vi.mock('../../hooks/useSession', () => ({ useSession: vi.fn() }));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}));

const fetchMock = vi.mocked(apiFetch);
const sessionMock = vi.mocked(useSession);

type SessionState = ReturnType<typeof useSession>;

const rawTags = [
  { id: 'npc', name: 'NPC', category: 'Type', main_position: 0 },
  { id: 'pc', name: 'PC', category: 'Type', main_position: 1 },
  { id: 'place', name: 'Luogo', category: null, main_position: null },
];

const rawItems = [{ tag_ids: ['npc'] }, { tag_ids: ['pc'] }];

interface Routes_ {
  members: unknown;
  tags: unknown;
  items: unknown;
  put: () => Promise<unknown>;
  patch: () => Promise<unknown>;
  tagPatch: () => Promise<unknown>;
}

const routes: Routes_ = {
  members: [],
  tags: rawTags,
  items: rawItems,
  put: () => Promise.resolve(rawItems),
  patch: () => Promise.resolve(rawRoom({ default_visibility: 'master' })),
  tagPatch: () => Promise.reject(new Error('unexpected')),
};

/** Sets the members the Room's members route answers with. */
function setMembers(list: unknown[]) {
  routes.members = list;
}

/** Renders the setup page at its route. */
function render() {
  renderWithProviders(
    <Routes>
      <Route path="/rooms/:roomId/setup" element={<RoomSetupPage />} />
    </Routes>,
    { route: '/rooms/room-1/setup' },
  );
  return { user: userEvent.setup() };
}

beforeEach(() => {
  fetchMock.mockReset();
  navigate.mockReset();
  vi.mocked(notifyError).mockClear();
  vi.mocked(notifySuccess).mockClear();
  routes.tags = rawTags;
  routes.items = rawItems;
  routes.put = () => Promise.resolve(rawItems);
  routes.patch = () => Promise.resolve(rawRoom({ default_visibility: 'master' }));
  routes.tagPatch = () => Promise.reject(new Error('unexpected'));
  setMembers([rawMember({ user_id: 'user-1', display_name: 'Io', is_admin: true })]);
  sessionMock.mockReturnValue({
    session: fakeSession('user-1'),
    loading: false,
  } as SessionState);
  fetchMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/rooms/room-1/members') return Promise.resolve(routes.members);
    if (path === '/rooms/room-1/tags/main' && init?.method === 'PUT') return routes.put();
    if (path === '/rooms/room-1/tags/main') return Promise.resolve(routes.items);
    if (path === '/rooms/room-1/tags' && init?.method === 'POST') {
      return Promise.resolve({ id: 'faction', name: 'Fazione', category: null });
    }
    if (path === '/rooms/room-1/tags') return Promise.resolve(routes.tags);
    if (path.startsWith('/rooms/room-1/tags/') && init?.method === 'PATCH') {
      return routes.tagPatch();
    }
    if (path === '/rooms/room-1' && init?.method === 'PATCH') return routes.patch();
    if (path === '/rooms/room-1') return Promise.resolve(rawRoom());
    if (path === '/rooms/room-1/audit-log') {
      return Promise.resolve({ entries: [rawHistoryEntry()], next_before: null });
    }
    if (path === '/account') return Promise.resolve(rawAccount());
    return Promise.resolve(undefined);
  });
});

/** The text of each grouping row, in order, once the list is on screen. */
const groupingRows = async () =>
  within((await screen.findAllByRole('list')).find((list) => list.tagName === 'OL') as HTMLElement)
    .getAllByRole('listitem')
    .map((row) => row.textContent);

/** Whether the page asked for the Room's Tags at all. */
const tagsWereRequested = () =>
  fetchMock.mock.calls.some(([path]) => path === '/rooms/room-1/tags');

describe('RoomSetupPage', () => {
  it('offers the Room export from the page header (spec 23)', async () => {
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Esporta' }));

    expect(await screen.findByRole('dialog', { name: 'Esporta la Stanza' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('waits on a loader while the session is resolving', () => {
    sessionMock.mockReturnValue({
      session: null,
      loading: true,
    } as SessionState);

    const { container } = renderWithProviders(
      <Routes>
        <Route path="/rooms/:roomId/setup" element={<RoomSetupPage />} />
      </Routes>,
      { route: '/rooms/room-1/setup' },
    );

    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
  });

  // Guards against a route reached with no Room id at all, which the app
  // itself never links to but a malformed URL could.
  it('renders nothing without a Room id in the URL', () => {
    renderWithProviders(
      <Routes>
        <Route path="/setup" element={<RoomSetupPage />} />
      </Routes>,
      { route: '/setup' },
    );

    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks an anonymous visitor to sign in', () => {
    sessionMock.mockReturnValue({
      session: null,
      loading: false,
    } as SessionState);
    render();

    expect(screen.getByText('Accedi per gestire questa Stanza.')).toBeInTheDocument();
  });

  it('reports a failed load', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render();

    expect(
      await screen.findByText('Errore nel caricamento delle impostazioni della Stanza.'),
    ).toBeInTheDocument();
  });

  // Spec 11: the setup is for the Room's Administrators only. The page
  // must not even fetch what it would show.
  it('turns away a member who is not an Administrator', async () => {
    setMembers([
      rawMember({ user_id: 'user-1', display_name: 'Io', is_admin: false }),
      rawMember({ user_id: 'user-2', display_name: 'Altro', is_admin: true }),
    ]);
    render();

    expect(
      await screen.findByText(
        'Solo un Amministratore o il Master della Stanza può aprire le impostazioni.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(tagsWereRequested()).toBe(false);
  });

  // Spec 22 Decision 4: the Master reads the visibility history even
  // without being an Administrator, and sees nothing else of the setup.
  it('shows a Master who is not an Administrator the history only', async () => {
    setMembers([
      rawMember({ user_id: 'user-1', display_name: 'Io', role: 'master', is_admin: false }),
      rawMember({ user_id: 'user-2', display_name: 'Altro', is_admin: true }),
    ]);
    render();

    expect(await screen.findByRole('tab', { name: 'Cronologia' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByRole('tab', { name: 'Impostazioni' })).not.toBeInTheDocument();
    expect(await screen.findAllByText('Il Cancello')).not.toHaveLength(0);
    expect(tagsWereRequested()).toBe(false);
  });

  it('opens the history tab for an Administrator', async () => {
    const { user } = render();

    await user.click(await screen.findByRole('tab', { name: 'Cronologia' }));

    expect(
      await screen.findByRole('heading', { name: 'Cronologia della visibilità' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/audit-log');
  });

  // Spec 22 Decision 5: Selective can't be a default.
  it('saves the default visibility an Administrator picks', async () => {
    const { user } = render();

    await user.click(await screen.findByRole('combobox', { name: 'Visibilità predefinita' }));
    expect(screen.queryByRole('option', { name: /Selettivo/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Solo Master' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1', {
        method: 'PATCH',
        json: { players_can_create_documents: undefined, default_visibility: 'master' },
      }),
    );
    await waitFor(() =>
      expect(notifySuccess).toHaveBeenCalledWith('Visibilità predefinita salvata.'),
    );
  });

  it('reports a default visibility that could not be saved', async () => {
    routes.patch = () => Promise.reject(new Error('no'));
    const { user } = render();

    await user.click(await screen.findByRole('combobox', { name: 'Visibilità predefinita' }));
    await user.click(screen.getByRole('option', { name: 'Privato (Owner + Master)' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it('shows an Administrator the members and the grouping', async () => {
    render();

    expect(
      await screen.findByRole('heading', { name: 'Impostazioni della Stanza' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Io')).toBeInTheDocument();
    expect(await groupingRows()).toEqual(['1.#NPC', '2.#PC']);
  });

  it('goes home after the Administrator leaves the Room', async () => {
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Esci' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
  });

  it('reports a failed Tags load', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path === '/rooms/room-1/members') return Promise.resolve(routes.members);
      if (path === '/account') return Promise.resolve(rawAccount());
      return Promise.reject(new Error('offline'));
    });
    render();

    expect(
      await screen.findByText('Errore nel caricamento delle impostazioni della Stanza.'),
    ).toBeInTheDocument();
  });

  // Spec 25c: the grouping saves on every change, with no "Save order".
  it('saves a new order at once', async () => {
    routes.put = () => Promise.resolve([{ tag_ids: ['pc'] }, { tag_ids: ['npc'] }]);
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Sposta NPC giù' }));

    expect(await groupingRows()).toEqual(['1.#PC', '2.#NPC']);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags/main', {
        method: 'PUT',
        json: { items: [{ tag_ids: ['pc'] }, { tag_ids: ['npc'] }] },
      }),
    );
    expect(screen.queryByRole('button', { name: 'Salva ordine' })).not.toBeInTheDocument();
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  // Spec 11_2: a combination is saved as an item of several Tags.
  it('saves a combination as soon as it is added', async () => {
    routes.put = () => Promise.resolve([...(rawItems as unknown[]), { tag_ids: ['pc', 'place'] }]);
    const { user } = render();

    await user.click(await screen.findByRole('combobox', { name: /Aggiungi una voce/ }));
    await user.click(screen.getByRole('option', { name: '#PC' }));
    await user.click(screen.getByRole('option', { name: '#Luogo' }));
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags/main', {
        method: 'PUT',
        json: {
          items: [{ tag_ids: ['npc'] }, { tag_ids: ['pc'] }, { tag_ids: ['pc', 'place'] }],
        },
      }),
    );
    expect(await groupingRows()).toEqual(['1.#NPC', '2.#PC', '3.#PC + #Luogo']);
  });

  it('rolls a rejected save back and reports it', async () => {
    routes.put = () => Promise.reject(new Error('no'));
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Sposta NPC giù' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    await waitFor(async () => expect(await groupingRows()).toEqual(['1.#NPC', '2.#PC']));
  });

  // Spec 25c: a rename shows at once in the Tag list and in the grouping.
  it('renames a Tag in place and shows the new name everywhere', async () => {
    routes.tagPatch = () =>
      Promise.resolve({ id: 'npc', name: 'PNG', category: 'Type', main_position: 0 });
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Rinomina il Tag NPC' }));
    const field = screen.getByRole('textbox', { name: 'Nuovo nome per NPC' });
    await user.clear(field);
    await user.type(field, 'PNG{Enter}');

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags/npc', {
        method: 'PATCH',
        json: { name: 'PNG' },
      }),
    );
    expect(await screen.findByRole('button', { name: 'Rinomina il Tag PNG' })).toBeInTheDocument();
    expect(await groupingRows()).toEqual(['1.#PNG', '2.#PC']);
    expect(notifySuccess).toHaveBeenCalledWith('Tag rinominato in "PNG"');
  });

  it('creates a Tag from the setup page', async () => {
    const { user } = render();

    await user.type(await screen.findByRole('textbox', { name: 'Nuovo Tag' }), 'Fazione{Enter}');

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags', {
        method: 'POST',
        json: { name: 'Fazione', category: null },
      }),
    );
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Tag "Fazione" creato'));
  });
});

describe('RoomMembersRedirect', () => {
  // Spec 13: the setup page can delete a Tag and the whole Room.
  it('lists the Tags with a delete button each', async () => {
    render();

    expect(await screen.findByRole('button', { name: 'Elimina il Tag Luogo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elimina il Tag NPC' })).toBeInTheDocument();
  });

  it('deletes a Tag after confirmation', async () => {
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Elimina il Tag Luogo' }));
    await user.click(screen.getByRole('button', { name: 'Elimina' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags/place', { method: 'DELETE' }),
    );
  });

  it('deletes the Room once its name is typed, then goes home', async () => {
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Elimina Stanza' }));
    await user.type(screen.getByLabelText('Scrivi "La Cripta" per confermare'), 'La Cripta');
    await user.click(screen.getByRole('button', { name: 'Elimina' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1', { method: 'DELETE' });
  });

  it('sends the old members URL to the setup page', () => {
    renderWithProviders(
      <Routes>
        <Route path="/rooms/:roomId/members" element={<RoomMembersRedirect />} />
        <Route path="/rooms/:roomId/setup" element={<div>setup page</div>} />
      </Routes>,
      { route: '/rooms/room-1/members' },
    );

    expect(screen.getByText('setup page')).toBeInTheDocument();
  });
});
