import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { useSession } from '../../hooks/useSession';
import { fakeSession, rawAccount, rawDocument, rawMap, rawMember, rawRoom } from '../fixtures';
import { renderWithProviders } from '../utils';
import { RoomDocumentsPage } from '../../pages/RoomDocumentsPage';
import { ViewAsProvider } from '../../components/ViewAsProvider';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../hooks/useSession', () => ({ useSession: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);
const sessionMock = vi.mocked(useSession);

type SessionState = ReturnType<typeof useSession>;

const tags = [
  { id: 'tag-1', name: 'Luoghi', category: null },
  { id: 'tag-2', name: 'PNG', category: null },
];

interface Routes {
  documents: unknown;
  members: unknown;
  room: unknown;
  mainItems: unknown;
  maps: unknown;
}

const routes: Routes = {
  documents: [rawDocument()],
  members: [rawMember()],
  room: rawRoom(),
  mainItems: [],
  maps: [],
};

const BACKLINKS = [
  {
    document_id: 'doc-9',
    document_name: 'La Locanda',
    mentions: [
      {
        kind: 'description',
        note_id: null,
        note_title: null,
        comment_id: null,
        comment_author_id: null,
        excerpt: 'Cerca in #Luoghi',
      },
    ],
  },
];

function mockApi(onWrite: (path: string) => Promise<unknown> = () => Promise.resolve()) {
  fetchMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method) return onWrite(path);
    if (path === '/rooms/room-1/documents') return Promise.resolve(routes.documents);
    if (path === '/rooms/room-1/maps') return Promise.resolve(routes.maps);
    if (path === '/rooms/room-1/tags/main') return Promise.resolve(routes.mainItems);
    if (path.endsWith('/backlinks')) return Promise.resolve(BACKLINKS);
    if (path === '/rooms/room-1/tags') return Promise.resolve(tags);
    if (path === '/rooms/room-1/members') return Promise.resolve(routes.members);
    if (path === '/rooms/room-1') return Promise.resolve(routes.room);
    if (path === '/account') return Promise.resolve(rawAccount());
    return Promise.resolve(routes.documents);
  });
}

// The filters and settings row starts collapsed: open it before using it.
async function showControls(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Mostra filtri e impostazioni' }));
  // The row mounts as the Collapse opens.
  await screen.findByRole('combobox', { name: 'Ordina per' });
}

function render(route = '/rooms/room-1/documents') {
  renderWithProviders(
    <Routes>
      <Route path="/rooms/:roomId/documents" element={<RoomDocumentsPage />} />
      <Route path="/" element={<p>Le mie Stanze</p>} />
    </Routes>,
    { route },
  );
  return { user: userEvent.setup() };
}

beforeEach(() => {
  routes.documents = [rawDocument()];
  routes.members = [rawMember({ user_id: 'user-1', role: 'master' })];
  routes.room = rawRoom();
  routes.mainItems = [];
  routes.maps = [];
  fetchMock.mockReset();
  sessionMock.mockReturnValue({ session: fakeSession('user-1'), loading: false } as SessionState);
  mockApi();
});

describe('RoomDocumentsPage', () => {
  it('shows the maps the viewer sees in a row on the page', async () => {
    routes.maps = [
      rawMap({ id: 'map-1', name: 'La Corte' }),
      rawMap({ id: 'map-2', name: 'Shibuya', kind: 'geographic' }),
    ];
    render();

    const strip = await screen.findByRole('navigation', { name: 'Mappe' });
    expect(within(strip).getByRole('link', { name: 'Tutte le mappe (2)' })).toHaveAttribute(
      'href',
      '/rooms/room-1/maps',
    );
    expect(within(strip).getByRole('link', { name: /^La Corte/ })).toHaveAttribute(
      'href',
      '/rooms/room-1/maps/map-1',
    );
    expect(within(strip).getByRole('link', { name: /^Shibuya/ })).toHaveAttribute(
      'href',
      '/rooms/room-1/maps/map-2',
    );
    // Each card says the map's kind and how many Documents it shows.
    expect(within(strip).getByRole('link', { name: /^Shibuya/ })).toHaveTextContent(
      'ShibuyaMappa geografica · 2 Documenti',
    );
    expect(within(strip).queryByRole('link', { name: 'Nuova mappa' })).not.toBeInTheDocument();
  });

  it('folds the maps row from its heading, like a group of Documents', async () => {
    routes.maps = [rawMap({ id: 'map-1', name: 'La Corte' })];
    render();
    await screen.findByText('Il Cancello');

    const strip = await screen.findByRole('navigation', { name: 'Mappe' });
    const toggle = within(strip).getByRole('button', { name: 'Mappe' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // The count and the link to the Maps page stay in sight.
    expect(within(strip).getByRole('link', { name: 'Tutte le mappe (1)' })).toBeVisible();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await within(strip).findByRole('link', { name: /^La Corte/ })).toBeVisible();
  });

  it('offers a new map when the Room has none and the viewer may create one', async () => {
    render();

    const strip = await screen.findByRole('navigation', { name: 'Mappe' });
    expect(within(strip).getByRole('link', { name: 'Nuova mappa' })).toHaveAttribute(
      'href',
      '/rooms/room-1/maps?new=1',
    );
  });

  it('shows no maps row to a Player who sees no map and may not create one', async () => {
    routes.members = [
      rawMember({ user_id: 'user-1', display_name: 'Io' }),
      rawMember({ user_id: 'user-2', role: 'master', display_name: 'Master' }),
    ];
    routes.room = rawRoom({ players_can_create_documents: false });
    render();
    await screen.findByText('Il Cancello');

    expect(screen.queryByRole('navigation', { name: 'Mappe' })).not.toBeInTheDocument();
  });

  it('waits on a loader while the session is resolving', () => {
    sessionMock.mockReturnValue({ session: null, loading: true } as SessionState);

    const { container } = renderWithProviders(
      <Routes>
        <Route path="/rooms/:roomId/documents" element={<RoomDocumentsPage />} />
      </Routes>,
      { route: '/rooms/room-1/documents' },
    );

    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks an anonymous visitor to sign in', () => {
    sessionMock.mockReturnValue({ session: null, loading: false } as SessionState);
    render();

    expect(screen.getByText('Accedi per vedere i Documenti di questa Stanza.')).toBeInTheDocument();
  });

  // Guards against a route reached with no Room id at all, which the app
  // itself never links to but a malformed URL could.
  it('renders nothing without a Room id in the URL', () => {
    renderWithProviders(
      <Routes>
        <Route path="/documents" element={<RoomDocumentsPage />} />
      </Routes>,
      { route: '/documents' },
    );

    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Tags and Members are separate queries from the Documents themselves; the
  // page must render (with nothing to show from them yet) while they load.
  it('renders before the Tags and Members queries settle', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path === '/rooms/room-1/documents') return Promise.resolve(routes.documents);
      if (path === '/rooms/room-1') return Promise.resolve(routes.room);
      if (path === '/account') return Promise.resolve(rawAccount());
      return new Promise(() => {});
    });
    render();

    expect(await screen.findByText('Il Cancello')).toBeInTheDocument();
  });

  it('lists the Documents under the Room name', async () => {
    render();

    expect(await screen.findByRole('heading', { level: 1, name: 'La Cripta' })).toBeInTheDocument();
    expect(screen.getByText('Il Cancello')).toBeInTheDocument();
  });

  it('invites the first Document when there are none', async () => {
    routes.documents = [];
    render();

    expect(await screen.findByText(/Nessun Documento ancora/)).toBeInTheDocument();
  });

  it('reports a failed load', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render();

    expect(await screen.findByText('Errore nel caricamento dei Documenti.')).toBeInTheDocument();
  });
});

// D-13/FR-D7, mirrored from the backend so a Player is never offered a form
// that would only be rejected on submit.
describe('who may create a Document', () => {
  it('offers it to the Master', async () => {
    render();

    expect(await screen.findByRole('button', { name: /Crea Documento/ })).toBeInTheDocument();
  });

  it('offers it to a Player when the Room allows it', async () => {
    routes.members = [rawMember({ user_id: 'user-1', role: 'player' })];
    routes.room = rawRoom({ players_can_create_documents: true });
    render();

    expect(await screen.findByRole('button', { name: /Crea Documento/ })).toBeInTheDocument();
  });

  it('withholds it from a Player when the Room forbids it', async () => {
    routes.members = [rawMember({ user_id: 'user-1', role: 'player' })];
    routes.room = rawRoom({ players_can_create_documents: false });
    render();

    await screen.findByText('Il Cancello');
    expect(screen.queryByRole('button', { name: /Crea Documento/ })).not.toBeInTheDocument();
  });

  // Spec 27 Decision 10: importing is for whoever may create Documents.
  it('offers the import to whoever may create Documents, and not to a Player who may not', async () => {
    const { user } = render();
    await screen.findByText('Il Cancello');
    await user.click(screen.getByRole('button', { name: 'Azioni per la Stanza La Cripta' }));
    expect(screen.getByRole('button', { name: 'Importa Documenti' })).toBeInTheDocument();
  });

  it('withholds the import from a Player when the Room forbids creating Documents', async () => {
    routes.members = [rawMember({ user_id: 'user-1', role: 'player' })];
    routes.room = rawRoom({ players_can_create_documents: false });
    const { user } = render();
    await screen.findByText('Il Cancello');

    await user.click(screen.getByRole('button', { name: 'Azioni per la Stanza La Cripta' }));

    expect(screen.getByRole('button', { name: 'Esporta' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Importa Documenti' })).not.toBeInTheDocument();
  });

  it('opens the create-Document modal', async () => {
    const { user } = render();
    await screen.findByText('Il Cancello');

    await user.click(screen.getByRole('button', { name: /Crea Documento/ }));

    expect(within(screen.getByRole('dialog')).getByRole('textbox', { name: /^Nome/ })).toBeInTheDocument();
  });

  it('closes the create-Document modal again', async () => {
    const { user } = render();
    await screen.findByText('Il Cancello');
    await user.click(screen.getByRole('button', { name: /Crea Documento/ }));

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('the Room setting', () => {
  it('is offered to the Master only', async () => {
    const { user } = render();
    await showControls(user);

    expect(
      await screen.findByRole('switch', { name: 'I Player possono creare Documenti' }),
    ).toBeInTheDocument();
  });

  it('is hidden from a Player', async () => {
    routes.members = [rawMember({ user_id: 'user-1', role: 'player' })];
    const { user } = render();

    await screen.findByText('Il Cancello');
    await showControls(user);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('saves a change', async () => {
    const writes: string[] = [];
    mockApi((path) => {
      writes.push(path);
      return Promise.resolve(rawRoom({ players_can_create_documents: false }));
    });
    const { user } = render();
    await screen.findByText('Il Cancello');
    await showControls(user);

    await user.click(screen.getByRole('switch', { name: 'I Player possono creare Documenti' }));

    await waitFor(() => expect(writes).toContain('/rooms/room-1'));
  });
});

// FR-N2: `?tag=…` is where a `#Tag` mention lands, and Tags combine with AND.
describe('filtering by Tag', () => {
  beforeEach(() => {
    routes.documents = [
      rawDocument({ id: 'doc-1', name: 'Il Cancello', tag_ids: ['tag-1'] }),
      rawDocument({ id: 'doc-2', name: 'Il Mercante', tag_ids: ['tag-2'] }),
    ];
  });

  it('shows every Document with no filter', async () => {
    render();

    expect(await screen.findByText('Il Cancello')).toBeInTheDocument();
    expect(screen.getByText('Il Mercante')).toBeInTheDocument();
  });

  it('honours a tag in the URL', async () => {
    render('/rooms/room-1/documents?tag=tag-2');

    expect(await screen.findByText('Il Mercante')).toBeInTheDocument();
    expect(screen.queryByText('Il Cancello')).not.toBeInTheDocument();
  });

  it('says so when a Tag matches nothing, and offers a way back', async () => {
    const { user } = render('/rooms/room-1/documents?tag=tag-nope');

    expect(await screen.findByText('Nessun Documento con questo Tag.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mostra tutti' }));

    await waitFor(() => expect(screen.getByText('Il Cancello')).toBeInTheDocument());
  });

  it('filters by picking a Tag from the combobox', async () => {
    const { user } = render();
    await screen.findByText('Il Cancello');
    await showControls(user);

    await user.click(screen.getByRole('combobox', { name: 'Filtra per Tag' }));
    await user.click(screen.getByRole('option', { name: '#PNG' }));

    await waitFor(() => expect(screen.queryByText('Il Cancello')).not.toBeInTheDocument());
    expect(screen.getByText('Il Mercante')).toBeInTheDocument();
  });

  it('pluralises the empty message for several Tags', async () => {
    render('/rooms/room-1/documents?tag=tag-1&tag=tag-2');

    expect(await screen.findByText('Nessun Documento con questi Tag.')).toBeInTheDocument();
  });

  it('hides the filter when the Room has no Documents', async () => {
    routes.documents = [];
    render();

    await screen.findByText(/Nessun Documento ancora/);
    expect(screen.queryByRole('combobox', { name: 'Filtra per Tag' })).not.toBeInTheDocument();
  });
});

// Specs 10, 11, 11_2: Documents group by the Room's Main items by default, and can
// be sorted or ungrouped from the controls next to the Tag filter.
describe('grouping and sorting', () => {
  beforeEach(() => {
    routes.mainItems = [{ tag_ids: ['tag-npc'] }];
    routes.documents = [
      rawDocument({ id: 'doc-1', name: 'Zanna', tag_ids: ['tag-npc'] }),
      rawDocument({ id: 'doc-2', name: 'Alba', tag_ids: [] }),
    ];
  });

  function mockApiWithMainTags() {
    fetchMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method) return Promise.resolve();
      if (path === '/rooms/room-1/documents') return Promise.resolve(routes.documents);
      if (path === '/rooms/room-1/maps') return Promise.resolve(routes.maps);
      if (path === '/rooms/room-1/tags/main') return Promise.resolve(routes.mainItems);
      if (path === '/rooms/room-1/tags')
        return Promise.resolve([...tags, { id: 'tag-npc', name: 'NPC', category: 'Type', main_position: 0 }]);
      if (path === '/rooms/room-1/members') return Promise.resolve(routes.members);
      if (path === '/rooms/room-1') return Promise.resolve(routes.room);
      if (path === '/account') return Promise.resolve(rawAccount());
      return Promise.resolve(routes.documents);
    });
  }

  // Under the page's h1, group headings are h2 (each holds its collapse
  // toggle) and a DocumentCard's title is h3 inside a group, h2 without one.
  const pageHeadings = (...levels: number[]) =>
    Array.from(screen.getByRole('main').querySelectorAll(levels.map((l) => `h${l}`).join(', ')));
  // The maps row's own folding heading is not a group of Documents.
  const inMapsRow = (h: Element) => h.closest('nav') !== null;
  const isGroupHeading = (h: Element) =>
    h.querySelector('[aria-expanded]') !== null && !inMapsRow(h);
  const groupHeadings = () => pageHeadings(2).filter(isGroupHeading).map((h) => h.textContent);
  const cardTitles = () =>
    pageHeadings(2, 3)
      .filter((h) => !isGroupHeading(h) && !inMapsRow(h))
      .map((h) => h.textContent);

  // The setup's Grouping places the maps row among the groups.
  const mapsRowAfter = () => {
    const strip = screen.getByRole('navigation', { name: 'Mappe' });
    return pageHeadings(2)
      .filter(isGroupHeading)
      .filter((h) => h.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING)
      .map((h) => h.textContent);
  };

  it('shows the maps row above the groups by default', async () => {
    routes.maps = [rawMap()];
    mockApiWithMainTags();
    render();

    await screen.findByRole('navigation', { name: 'Mappe' });
    await waitFor(() => expect(groupHeadings()).toEqual(['#NPC', 'Senza Tag principale']));
    expect(mapsRowAfter()).toEqual([]);
  });

  it('shows the maps row after the Main items the setup places before it', async () => {
    routes.maps = [rawMap()];
    routes.room = rawRoom({ maps_position: 1 });
    mockApiWithMainTags();
    render();

    await waitFor(() => expect(groupHeadings()).toEqual(['#NPC', 'Senza Tag principale']));
    await screen.findByRole('navigation', { name: 'Mappe' });
    // Past the last Main item, still before the fallback group.
    expect(mapsRowAfter()).toEqual(['#NPC']);
  });

  it('keeps the maps row before the fallback group when its place is past every item', async () => {
    routes.maps = [rawMap()];
    routes.room = rawRoom({ maps_position: 5 });
    mockApiWithMainTags();
    render();

    await waitFor(() => expect(groupHeadings()).toEqual(['#NPC', 'Senza Tag principale']));
    await screen.findByRole('navigation', { name: 'Mappe' });
    expect(mapsRowAfter()).toEqual(['#NPC']);
  });

  it('shows the maps row after every group when no group follows its place', async () => {
    routes.maps = [rawMap()];
    routes.room = rawRoom({ maps_position: 1 });
    routes.documents = [rawDocument({ id: 'doc-1', name: 'Zanna', tag_ids: ['tag-npc'] })];
    mockApiWithMainTags();
    render();

    await waitFor(() => expect(groupHeadings()).toEqual(['#NPC']));
    await screen.findByRole('navigation', { name: 'Mappe' });
    expect(mapsRowAfter()).toEqual(['#NPC']);
  });

  it('shows the maps row above the groups while the Room is still loading', async () => {
    routes.maps = [rawMap()];
    routes.room = new Promise(() => {});
    mockApiWithMainTags();
    render();

    await waitFor(() => expect(groupHeadings()).toEqual(['#NPC', 'Senza Tag principale']));
    await screen.findByRole('navigation', { name: 'Mappe' });
    expect(mapsRowAfter()).toEqual([]);
  });

  it('shows the maps row on top when the Documents are not grouped', async () => {
    routes.maps = [rawMap()];
    routes.room = rawRoom({ maps_position: 1 });
    mockApiWithMainTags();
    render('/rooms/room-1/documents?groupBy=none');

    await screen.findByRole('navigation', { name: 'Mappe' });
    expect(screen.getByRole('link', { name: /^La Corte/ })).toBeInTheDocument();
    expect(groupHeadings()).toEqual([]);
  });

  // The outline never skips a level: h1 page title, h2 group, h3 card - or
  // h2 card when there are no groups.
  it('nests card titles one level under their group heading', async () => {
    mockApiWithMainTags();
    render();

    await waitFor(() => expect(groupHeadings()).toEqual(['#NPC', 'Senza Tag principale']));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('La Cripta');
    expect(pageHeadings(3).map((h) => h.textContent)).toEqual(['Zanna', 'Alba']);
  });

  it('groups Documents under their Main Tag by default, ungrouped ones last', async () => {
    mockApiWithMainTags();
    render();

    await screen.findByText('Zanna');
    expect(groupHeadings()).toEqual(['#NPC', 'Senza Tag principale']);
  });

  // Spec 11_2: a combination is a heading of its own, in the chosen order, and
  // holds only the Documents carrying all of its Tags.
  it('shows a combination as its own group in the chosen order', async () => {
    routes.documents = [
      rawDocument({ id: 'doc-1', name: 'Zanna', tag_ids: ['tag-npc', 'tag-1'] }),
      rawDocument({ id: 'doc-2', name: 'Alba', tag_ids: ['tag-npc'] }),
    ];
    routes.mainItems = [{ tag_ids: ['tag-npc', 'tag-1'] }, { tag_ids: ['tag-npc'] }];
    mockApiWithMainTags();
    render();

    // Zanna carries both Tags, so it shows under the combination and under #NPC.
    expect(await screen.findAllByText('Zanna')).toHaveLength(2);
    expect(groupHeadings()).toEqual(['#NPC + #Luoghi', '#NPC']);
  });

  it('drops the grouping headings when set to no grouping', async () => {
    mockApiWithMainTags();
    const { user } = render();
    await screen.findByText('Zanna');
    await showControls(user);

    await user.click(screen.getByRole('combobox', { name: 'Raggruppa per' }));
    await user.click(screen.getByText('Nessun raggruppamento'));

    await waitFor(() => expect(groupHeadings()).toEqual([]));
    expect(screen.getByText('Zanna')).toBeInTheDocument();
    expect(screen.getByText('Alba')).toBeInTheDocument();
  });

  // Switching back to the default clears the URL param instead of writing it
  // out explicitly.
  it('drops the groupBy param from the URL when set back to the default', async () => {
    mockApiWithMainTags();
    const { user } = render('/rooms/room-1/documents?groupBy=none');
    await screen.findByText('Zanna');
    expect(groupHeadings()).toEqual([]);
    await showControls(user);

    await user.click(screen.getByRole('combobox', { name: 'Raggruppa per' }));
    await user.click(screen.getByText('Raggruppa per Tag principale'));

    await waitFor(() => expect(groupHeadings()).toEqual(['#NPC', 'Senza Tag principale']));
  });

  it('honours group-by and sort from the URL', async () => {
    mockApiWithMainTags();
    render('/rooms/room-1/documents?groupBy=none&sort=name-desc');

    await screen.findByText('Zanna');
    expect(groupHeadings()).toEqual([]);
    expect(cardTitles()).toEqual(['Zanna', 'Alba']);
  });

  it('sorts Documents A-Z by default and reverses on Z-A', async () => {
    mockApiWithMainTags();
    const { user } = render('/rooms/room-1/documents?groupBy=none');
    await screen.findByText('Zanna');

    expect(cardTitles()).toEqual(['Alba', 'Zanna']);
    await showControls(user);

    await user.click(screen.getByRole('combobox', { name: 'Ordina per' }));
    await user.click(screen.getByText('Nome (Z-A)'));

    await waitFor(() => expect(cardTitles()).toEqual(['Zanna', 'Alba']));
  });

  it('hides the grouping and sorting controls when the Room has no Documents', async () => {
    routes.documents = [];
    render();

    await screen.findByText(/Nessun Documento ancora/);
    expect(screen.queryByRole('combobox', { name: 'Raggruppa per' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Ordina per' })).not.toBeInTheDocument();
  });
});

describe("the Room's actions beside the title", () => {
  it('unfold from the "⋮" at the end of the title row', async () => {
    const { user } = render();
    await screen.findByText('Il Cancello');

    await user.click(screen.getByRole('button', { name: 'Azioni per la Stanza La Cripta' }));

    expect(screen.getByRole('button', { name: 'Esci' })).toBeInTheDocument();
  });

  it('take the user back to their Rooms after leaving', async () => {
    const writes: string[] = [];
    mockApi((path) => {
      writes.push(path);
      return Promise.resolve();
    });
    const { user } = render();
    await screen.findByText('Il Cancello');

    await user.click(screen.getByRole('button', { name: 'Azioni per la Stanza La Cripta' }));
    await user.click(screen.getByRole('button', { name: 'Esci' }));
    const dialog = await screen.findByRole('dialog', { name: 'Uscire da "La Cripta"?' });
    await user.click(within(dialog).getByRole('button', { name: 'Esci' }));

    expect(await screen.findByText('Le mie Stanze')).toBeInTheDocument();
    expect(writes).toContain('/rooms/room-1/members/user-1');
  });
});

// Spec 22b: the Master previews the Room as one of its members, read-only.
describe('viewing the Room as a member', () => {
  it('starts from the "⋮" and leaves only reading', async () => {
    routes.members = [
      rawMember({ user_id: 'user-1', role: 'master', display_name: 'Io' }),
      rawMember({ user_id: 'user-2', display_name: 'Alice' }),
    ];
    renderWithProviders(
      <Routes>
        <Route path="/rooms/:roomId/documents" element={<RoomDocumentsPage />} />
      </Routes>,
      { route: '/rooms/room-1/documents', wrapper: ViewAsProvider },
    );
    const user = userEvent.setup();
    await screen.findByText('Il Cancello');
    expect(screen.getByRole('button', { name: /Crea Documento/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Azioni per la Stanza La Cripta' }));
    await user.click(screen.getByRole('button', { name: 'Vedi come un membro' }));
    expect(screen.queryByRole('menuitem', { name: 'Io' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('menuitem', { name: 'Alice' }));

    expect(
      await screen.findByText('Stai vedendo la Stanza come Alice. Sola lettura.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Crea Documento/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Azioni per la Stanza La Cripta' }),
    ).not.toBeInTheDocument();
    // The preview has no Room menu but still reaches the maps (spec 28).
    expect(screen.getByRole('link', { name: 'Mappe' })).toHaveAttribute(
      'href',
      '/rooms/room-1/maps',
    );
  });

  it('is not offered to a Player', async () => {
    routes.members = [
      rawMember({ user_id: 'user-1', display_name: 'Io' }),
      rawMember({ user_id: 'user-2', role: 'master', display_name: 'Master' }),
    ];
    const { user } = render();
    await screen.findByText('Il Cancello');

    await user.click(screen.getByRole('button', { name: 'Azioni per la Stanza La Cripta' }));

    expect(screen.queryByRole('button', { name: 'Vedi come un membro' })).not.toBeInTheDocument();
  });
});

// The filters/settings row next to the title (the Room setting Switch, the
// Tag filter, group-by and sort) collapses independently of the title, which
// always stays visible.
describe('collapsing the filters and settings row', () => {
  const toggleButton = (name: string | RegExp) => screen.getByRole('button', { name });

  it('starts collapsed, with the title still visible', async () => {
    render();

    await screen.findByText('Il Cancello');
    expect(screen.getByRole('heading', { level: 1, name: 'La Cripta' })).toBeVisible();
    expect(toggleButton('Mostra filtri e impostazioni')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('switch', { name: 'I Player possono creare Documenti' })).not.toBeInTheDocument();
  });

  // A `#Tag` mention lands on the list already filtered: show that filter.
  it('starts expanded when the page opens filtered by Tag', async () => {
    render('/rooms/room-1/documents?tag=tag-1');

    await screen.findByText('Il Cancello');
    expect(toggleButton('Nascondi filtri e impostazioni')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('combobox', { name: 'Raggruppa per' })).toBeVisible();
  });

  it('expands the row on click, showing the controls', async () => {
    const { user } = render();
    await screen.findByText('Il Cancello');

    await user.click(toggleButton('Mostra filtri e impostazioni'));

    expect(toggleButton('Nascondi filtri e impostazioni')).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'I Player possono creare Documenti' })).toBeVisible(),
    );
    expect(screen.getByRole('combobox', { name: 'Raggruppa per' })).toBeVisible();
  });

  it('collapses the row again on a second click', async () => {
    const { user } = render();
    await screen.findByText('Il Cancello');

    await user.click(toggleButton('Mostra filtri e impostazioni'));
    await user.click(toggleButton('Nascondi filtri e impostazioni'));

    expect(toggleButton('Mostra filtri e impostazioni')).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() =>
      expect(
        screen.queryByRole('switch', { name: 'I Player possono creare Documenti' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('offers no toggle when there is nothing to show or hide', async () => {
    routes.members = [rawMember({ user_id: 'user-1', role: 'player' })];
    routes.documents = [];
    render();

    await screen.findByText(/Nessun Documento ancora/);
    expect(screen.queryByRole('button', { name: /filtri e impostazioni/ })).not.toBeInTheDocument();
  });
});

// Clicking a group header collapses/expands just that group (spec: an arrow
// on the left reflects whether it's expanded).
describe('collapsing a group', () => {
  beforeEach(() => {
    routes.mainItems = [{ tag_ids: ['tag-npc'] }];
    routes.documents = [
      rawDocument({ id: 'doc-1', name: 'Zanna', tag_ids: ['tag-npc'] }),
      rawDocument({ id: 'doc-2', name: 'Alba', tag_ids: [] }),
    ];
  });

  function mockApiWithMainTags() {
    fetchMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method) return Promise.resolve();
      if (path === '/rooms/room-1/documents') return Promise.resolve(routes.documents);
      if (path === '/rooms/room-1/maps') return Promise.resolve(routes.maps);
      if (path === '/rooms/room-1/tags/main') return Promise.resolve(routes.mainItems);
      if (path === '/rooms/room-1/tags')
        return Promise.resolve([...tags, { id: 'tag-npc', name: 'NPC', category: 'Type', main_position: 0 }]);
      if (path === '/rooms/room-1/members') return Promise.resolve(routes.members);
      if (path === '/rooms/room-1') return Promise.resolve(routes.room);
      if (path === '/account') return Promise.resolve(rawAccount());
      return Promise.resolve(routes.documents);
    });
  }

  const groupButton = (name: string) => screen.getByRole('button', { name });

  it('starts every group expanded', async () => {
    mockApiWithMainTags();
    render();
    await screen.findByText('Zanna');

    expect(groupButton('#NPC')).toHaveAttribute('aria-expanded', 'true');
    expect(groupButton('Senza Tag principale')).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses a group on click, hiding its Documents', async () => {
    mockApiWithMainTags();
    const { user } = render();
    await screen.findByText('Zanna');

    await user.click(groupButton('#NPC'));

    expect(groupButton('#NPC')).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(screen.getByText('Zanna')).not.toBeVisible());
  });

  it('expands it again on a second click', async () => {
    mockApiWithMainTags();
    const { user } = render();
    await screen.findByText('Zanna');

    await user.click(groupButton('#NPC'));
    await user.click(groupButton('#NPC'));

    expect(groupButton('#NPC')).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(screen.getByText('Zanna')).toBeVisible());
  });

  it('collapses groups independently of one another', async () => {
    mockApiWithMainTags();
    const { user } = render();
    await screen.findByText('Zanna');

    await user.click(groupButton('#NPC'));

    expect(groupButton('#NPC')).toHaveAttribute('aria-expanded', 'false');
    expect(groupButton('Senza Tag principale')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Alba')).toBeVisible();
  });
});

// Spec 20 Decision 8: a Tag's "Mentioned in" shows on the list filtered by
// exactly that Tag.
describe('Tag backlinks', () => {
  it('shows where the one filtered Tag is mentioned', async () => {
    render('/rooms/room-1/documents?tag=tag-1');

    const backlinks = await screen.findByTestId('backlinks');
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags/tag-1/backlinks');
    // Below the results, and closed until opened.
    const card = await screen.findByText('Il Cancello');
    expect(card.compareDocumentPosition(backlinks)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(backlinks).getByRole('button', { name: /Menzionato in/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('shows nothing for no Tag or for several', async () => {
    render('/rooms/room-1/documents?tag=tag-1&tag=tag-2');
    await screen.findByText(/Nessun Documento/);

    expect(screen.queryByTestId('backlinks')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/backlinks'));
  });
});
