import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { notifyError, notifySuccess } from '../../lib/notify';
import { useSession } from '../../hooks/useSession';
import {
  fakeSession,
  rawAccount,
  rawDocument,
  rawDocumentRead,
  rawImage,
  rawMember,
  rawDocumentFile,
  rawNote,
  rawComment,
} from '../fixtures';
import { renderWithProviders } from '../utils';
import { DocumentDetailPage } from '../../pages/DocumentDetailPage';
import { ViewAsContext } from '../../hooks/useViewAs';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock('../../hooks/useSession', () => ({ useSession: vi.fn() }));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}));

const fetchMock = vi.mocked(apiFetch);
const sessionMock = vi.mocked(useSession);

type SessionState = ReturnType<typeof useSession>;

const tags = [
  { id: 'tag-1', name: 'Luoghi', category: null },
  { id: 'tag-2', name: 'PNG', category: null },
];

const DOC = '/rooms/room-1/documents/doc-1';

interface Routes {
  document: unknown;
  members: unknown;
  comments: unknown;
  backlinks: unknown;
}

const routes: Routes = { document: rawDocument(), members: [], comments: [], backlinks: [] };

function mockApi(onWrite: (path: string) => Promise<unknown> = () => Promise.resolve()) {
  fetchMock.mockImplementation((path: string, init?: { method?: string }) => {
    // Every visit is recorded once the Thread loads (spec 19b).
    if (path === `${DOC}/read`) return Promise.resolve(rawDocumentRead());
    if (init?.method) return onWrite(path);
    if (path === DOC) return Promise.resolve(routes.document);
    if (path === `${DOC}/comments`) return Promise.resolve(routes.comments);
    if (path === `${DOC}/backlinks`) return Promise.resolve(routes.backlinks);
    if (path === '/rooms/room-1/documents') return Promise.resolve([routes.document]);
    if (path === '/rooms/room-1/tags') return Promise.resolve(tags);
    if (path === '/rooms/room-1/members') return Promise.resolve(routes.members);
    if (path === '/account') return Promise.resolve(rawAccount());
    if (path === '/rooms/room-1/characters/mine') return Promise.resolve([]);
    return Promise.resolve(routes.document);
  });
}

function render() {
  renderWithProviders(
    <Routes>
      <Route path="/rooms/:roomId/documents/:documentId" element={<DocumentDetailPage />} />
    </Routes>,
    { route: DOC },
  );
  return { user: userEvent.setup() };
}

const editButton = () => screen.getByRole('button', { name: 'Modifica' });

beforeEach(() => {
  routes.document = rawDocument({ owner_ids: ['user-1'] });
  routes.members = [rawMember({ user_id: 'user-1', display_name: 'Io' })];
  routes.comments = [];
  routes.backlinks = [];
  fetchMock.mockReset();
  navigate.mockReset();
  vi.mocked(notifyError).mockClear();
  sessionMock.mockReturnValue({ session: fakeSession('user-1'), loading: false } as SessionState);
  mockApi();
  // jsdom's `window.history` persists across tests in this file (MemoryRouter
  // never touches it), so the "back" button's history check starts clean.
  window.history.replaceState(null, '', '/');
});

describe('DocumentDetailPage', () => {
  it('waits on a loader while the session is resolving', () => {
    sessionMock.mockReturnValue({ session: null, loading: true } as SessionState);

    const { container } = renderWithProviders(
      <Routes>
        <Route path="/rooms/:roomId/documents/:documentId" element={<DocumentDetailPage />} />
      </Routes>,
      { route: DOC },
    );

    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks an anonymous visitor to sign in', () => {
    sessionMock.mockReturnValue({ session: null, loading: false } as SessionState);
    render();

    expect(screen.getByText('Accedi per vedere questo Documento.')).toBeInTheDocument();
  });

  it('shows the Document with its Tags and description', async () => {
    render();

    expect(await screen.findByRole('heading', { name: 'Il Cancello' })).toBeInTheDocument();
    expect(screen.getByText('#Luoghi')).toBeInTheDocument();
    expect(screen.getByText('Una porta di pietra.')).toBeInTheDocument();
  });

  // Like on the Documents list, each Tag leads to the list filtered by it.
  it('links each Tag to the Documents filtered by it', async () => {
    render();

    const tag = await screen.findByRole('link', { name: '#Luoghi' });
    expect(tag).toHaveAttribute('href', '/rooms/room-1/documents?tag=tag-1');
  });

  it('says so when there is no description', async () => {
    routes.document = rawDocument({ owner_ids: ['user-1'], description: '' });
    render();

    expect(await screen.findByText('Nessuna descrizione.')).toBeInTheDocument();
  });

  it('shows the visibility level', async () => {
    routes.document = rawDocument({ owner_ids: ['user-1'], visibility: 'master' });
    render();

    expect(await screen.findByText('Solo Master')).toBeInTheDocument();
  });

  // A Document hidden from this viewer comes back as a 404, and must not
  // hint that it exists (VR-07).
  it('offers a way back when the Document is not visible', async () => {
    fetchMock.mockRejectedValue(new Error('Not found'));
    render();

    expect(await screen.findByText('Documento non trovato o non visibile.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Torna ai Documenti' })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents',
    );
  });

  it("goes back to the Room's Documents", async () => {
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });

    await user.click(screen.getByRole('button', { name: 'Documenti' }));

    expect(navigate).toHaveBeenCalledWith('/rooms/room-1/documents');
  });

  // Guards against a route reached with no Room/Document id at all, which
  // the app itself never links to but a malformed URL could.
  it('renders nothing without a Room and Document id in the URL', () => {
    renderWithProviders(
      <Routes>
        <Route path="/documents/:documentId" element={<DocumentDetailPage />} />
      </Routes>,
      { route: '/documents/doc-1' },
    );

    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Tags and Members are separate queries from the Document itself; the page
  // must render (with nothing to show yet) while they're still in flight.
  it('renders before the Tags and Members queries settle', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path === DOC) return Promise.resolve(routes.document);
      if (path === `${DOC}/comments`) return Promise.resolve(routes.comments);
      if (path === '/account') return Promise.resolve(rawAccount());
      if (path === '/rooms/room-1/characters/mine') return Promise.resolve([]);
      return new Promise(() => {});
    });
    render();

    expect(await screen.findByRole('heading', { name: 'Il Cancello' })).toBeInTheDocument();
  });

  it('shows the Comment section', async () => {
    render();

    expect(await screen.findByRole('heading', { name: 'Commenti' })).toBeInTheDocument();
  });
});

// Spec 27: every member who sees a Document exports it, owner or not.
describe('exporting the Document', () => {
  it('offers the export to a member who cannot edit it, and opens its dialog', async () => {
    routes.document = rawDocument({ owner_ids: ['user-2'] });
    routes.members = [rawMember({ user_id: 'user-1', role: 'player' })];
    const { user } = render();

    expect(screen.queryByRole('button', { name: 'Modifica' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Esporta il Documento' }));

    expect(await screen.findByRole('dialog', { name: 'Esporta il Documento' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

// D-12: an Owner or the Master may edit; nobody else.
describe('who may edit', () => {
  it('offers editing to an Owner', async () => {
    render();

    expect(await screen.findByRole('button', { name: 'Modifica' })).toBeInTheDocument();
  });

  it('offers editing to the Master even without an Owner row', async () => {
    routes.document = rawDocument({ owner_ids: ['user-2'] });
    routes.members = [rawMember({ user_id: 'user-1', role: 'master' })];
    render();

    expect(await screen.findByRole('button', { name: 'Modifica' })).toBeInTheDocument();
  });

  it('withholds it from a Player who is not an Owner', async () => {
    routes.document = rawDocument({ owner_ids: ['user-2'] });
    routes.members = [rawMember({ user_id: 'user-1', role: 'player' })];
    render();

    await screen.findByRole('heading', { name: 'Il Cancello' });
    expect(screen.queryByRole('button', { name: 'Modifica' })).not.toBeInTheDocument();
    // Spec 24b: the Document's history is for the same people.
    expect(screen.queryByRole('button', { name: /^Storico/ })).not.toBeInTheDocument();
  });

  it("opens the Document's history for an Owner, and none on its Notes", async () => {
    routes.document = rawDocument({ owner_ids: ['user-1'], notes: [rawNote()] });
    const otherRoutes = fetchMock.getMockImplementation() as NonNullable<
      ReturnType<typeof fetchMock.getMockImplementation>
    >;
    fetchMock.mockImplementation((...args: Parameters<typeof otherRoutes>) => {
      if (args[0] === `${DOC}/versions`) {
        return Promise.resolve([]);
      }
      return otherRoutes(...args);
    });
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Storico: Il Cancello' }));
    expect(await screen.findByText('Nessuna revisione.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`${DOC}/versions`);
    expect(
      screen.queryByRole('button', { name: 'Storico: Porta segreta' }),
    ).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Nessuna revisione.')).not.toBeInTheDocument());
  });
});

describe('editing', () => {
  it('opens the form with the current values', async () => {
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });

    await user.click(editButton());

    expect(screen.getByRole('textbox', { name: /^Nome/ })).toHaveValue('Il Cancello');
    // Inside the mentions provider the description is a combobox, since it
    // suggests Documents and Tags as you type `#`.
    expect(screen.getByRole('combobox', { name: /Descrizione/ })).toHaveValue(
      'Una porta di pietra.',
    );
  });

  it('saves the changes', async () => {
    const writes: string[] = [];
    mockApi((path) => {
      writes.push(path);
      return Promise.resolve(rawDocument({ owner_ids: ['user-1'], name: 'Nuovo nome' }));
    });
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });
    await user.click(editButton());

    await user.clear(screen.getByRole('textbox', { name: /^Nome/ }));
    await user.type(screen.getByRole('textbox', { name: /^Nome/ }), 'Nuovo nome');
    await user.click(screen.getByRole('button', { name: 'Salva modifiche' }));

    await waitFor(() => expect(writes).toContain(DOC));
  });

  it('cannot save an empty name', async () => {
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });
    await user.click(editButton());

    await user.clear(screen.getByRole('textbox', { name: /^Nome/ }));

    expect(screen.getByRole('button', { name: 'Salva modifiche' })).toBeDisabled();
  });

  it('leaves the form on cancel', async () => {
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });
    await user.click(editButton());

    await user.click(screen.getByRole('button', { name: 'Annulla' }));

    expect(screen.queryByRole('textbox', { name: /^Nome/ })).not.toBeInTheDocument();
    expect(screen.getByText('Una porta di pietra.')).toBeInTheDocument();
  });

  it('reports a rejected save', async () => {
    mockApi(() => Promise.reject(new Error('Only an Owner can edit')));
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });
    await user.click(editButton());

    await user.type(screen.getByRole('textbox', { name: /^Nome/ }), '!');
    await user.click(screen.getByRole('button', { name: 'Salva modifiche' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });

  // Like the PDFs' upload, adding images needs no edit mode.
  it('offers image uploads to an Owner outside edit mode', async () => {
    render();

    expect(await screen.findByRole('button', { name: /Carica immagini/ })).toBeInTheDocument();
  });

  it('hides image uploads from a reader who is not an Owner', async () => {
    routes.document = rawDocument({ owner_ids: ['user-2'] });
    routes.members = [rawMember({ user_id: 'user-1', role: 'player' })];
    render();

    await screen.findByRole('heading', { name: 'Il Cancello' });
    expect(screen.queryByRole('button', { name: /Carica immagini/ })).not.toBeInTheDocument();
  });
});

// The Owner deletes the Document from edit mode, behind a confirmation
// modal - the action is irreversible (Comments, images and Tag links go
// with it), unlike deleting a single gallery image.
describe('deleting the Document', () => {
  it('offers deletion only while editing', async () => {
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });

    expect(screen.queryByRole('button', { name: 'Elimina Documento' })).not.toBeInTheDocument();

    await user.click(editButton());
    expect(screen.getByRole('button', { name: 'Elimina Documento' })).toBeInTheDocument();
  });

  it('asks for confirmation before deleting', async () => {
    const writes: string[] = [];
    mockApi((path) => {
      writes.push(path);
      return Promise.resolve();
    });
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });
    await user.click(editButton());

    await user.click(screen.getByRole('button', { name: 'Elimina Documento' }));

    expect(screen.getByText('Eliminare questo Documento?')).toBeInTheDocument();
    expect(writes).not.toContain(DOC);
  });

  it('deletes nothing when the confirmation is dismissed', async () => {
    const writes: string[] = [];
    mockApi((path) => {
      writes.push(path);
      return Promise.resolve();
    });
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });
    await user.click(editButton());
    await user.click(screen.getByRole('button', { name: 'Elimina Documento' }));
    const dialog = within(screen.getByRole('dialog'));

    await user.click(dialog.getByRole('button', { name: 'Annulla' }));

    expect(screen.queryByText('Eliminare questo Documento?')).not.toBeInTheDocument();
    expect(writes).not.toContain(DOC);
  });

  it('dismisses the confirmation on Escape too, not just Cancel', async () => {
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });
    await user.click(editButton());
    await user.click(screen.getByRole('button', { name: 'Elimina Documento' }));
    expect(screen.getByText('Eliminare questo Documento?')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByText('Eliminare questo Documento?')).not.toBeInTheDocument(),
    );
  });

  it('deletes the Document once confirmed and navigates back to the list', async () => {
    const writes: string[] = [];
    mockApi((path) => {
      writes.push(path);
      return Promise.resolve();
    });
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });
    await user.click(editButton());
    await user.click(screen.getByRole('button', { name: 'Elimina Documento' }));

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Elimina' }));

    await waitFor(() => expect(writes).toContain(DOC));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/rooms/room-1/documents'));
  });

  it('reports a rejected deletion and stays on the page', async () => {
    mockApi(() => Promise.reject(new Error('Only an Owner can delete')));
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });
    await user.click(editButton());
    await user.click(screen.getByRole('button', { name: 'Elimina Documento' }));

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Elimina' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });
});

// Spec 10: creating a Tag inline while editing is only offered to whoever may
// manage Tags (Administrator or Master), matching the create-Document modal.
describe('creating a Tag while editing', () => {
  it('offers it to the Master', async () => {
    routes.members = [rawMember({ user_id: 'user-1', role: 'master' })];
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });

    await user.click(editButton());

    expect(screen.getByRole('textbox', { name: 'Nuovo tag' })).toBeInTheDocument();
  });

  it('withholds it from an Owner who is a Player', async () => {
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });

    await user.click(editButton());

    expect(screen.queryByRole('textbox', { name: 'Nuovo tag' })).not.toBeInTheDocument();
  });

  // Guards the handler itself, not just the disabled Save button.
  it('drops a direct form submission while a Tag is still being created', async () => {
    routes.members = [rawMember({ user_id: 'user-1', role: 'master' })];
    mockApi(() => new Promise(() => {}));
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });
    await user.click(editButton());

    const tagField = screen.getByRole('textbox', { name: 'Nuovo tag' });
    await user.type(tagField, 'Fazione');
    const tagGroup = tagField.closest('.mantine-Group-root') as HTMLElement;
    await user.click(within(tagGroup).getByRole('button', { name: 'Aggiungi' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Salva modifiche' })).toBeDisabled(),
    );

    fireEvent.submit(
      screen.getByRole('textbox', { name: /^Nome/ }).closest('form') as HTMLFormElement,
    );

    expect(fetchMock).not.toHaveBeenCalledWith(DOC, expect.objectContaining({ method: 'PATCH' }));
  });
});

describe('adding images', () => {
  it('uploads a picked file', async () => {
    const writes: string[] = [];
    mockApi((path) => {
      writes.push(path);
      return Promise.resolve(routes.document);
    });
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });

    const input = window.document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['bytes'], 'mappa.png', { type: 'image/png' }));

    await waitFor(() => expect(writes).toContain(`${DOC}/images`));
  });

  it('imports an image from a URL', async () => {
    const writes: string[] = [];
    mockApi((path) => {
      writes.push(path);
      return Promise.resolve(routes.document);
    });
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });
    await user.click(screen.getByRole('button', { name: 'Da URL' }));

    await user.type(
      await screen.findByPlaceholderText("https://… URL dell'immagine"),
      'https://example.com/map.png',
    );
    await user.click(screen.getByRole('button', { name: 'Aggiungi da URL' }));

    await waitFor(() => expect(writes).toContain(`${DOC}/images/from-url`));
  });

  it('reports a rejected upload', async () => {
    mockApi(() => Promise.reject(new Error('Too many images')));
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });

    const input = window.document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['bytes'], 'mappa.png', { type: 'image/png' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });
});

describe('the image gallery', () => {
  beforeEach(() => {
    routes.document = rawDocument({
      owner_ids: ['user-1'],
      images: [rawImage({ id: 'image-1', is_favorite: true })],
    });
  });

  // Spec 07: picking the leading image is reversible, so unlike deletion it
  // is not gated on edit mode.
  it('lets an Owner move the favorite without entering edit mode', async () => {
    routes.document = rawDocument({
      owner_ids: ['user-1'],
      images: [rawImage({ id: 'image-2', is_favorite: false })],
    });
    const writes: string[] = [];
    mockApi((path) => {
      writes.push(path);
      return Promise.resolve(routes.document);
    });
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });

    await user.click(screen.getByRole('button', { name: 'Usa come immagine principale' }));

    await waitFor(() => expect(writes).toContain(`${DOC}/images/image-2/favorite`));
  });

  it('hides the heart from a viewer who is not an Owner', async () => {
    routes.document = rawDocument({
      owner_ids: ['user-2'],
      images: [rawImage({ id: 'image-1' })],
    });
    routes.members = [rawMember({ user_id: 'user-1', role: 'player' })];
    render();

    await screen.findByRole('heading', { name: 'Il Cancello' });
    expect(
      screen.queryByRole('button', { name: 'Usa come immagine principale' }),
    ).not.toBeInTheDocument();
  });

  it('offers deletion only while editing', async () => {
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });

    expect(screen.queryByRole('button', { name: 'Elimina immagine' })).not.toBeInTheDocument();

    await user.click(editButton());
    expect(screen.getByRole('button', { name: 'Elimina immagine' })).toBeInTheDocument();
  });

  it('deletes an image once confirmed', async () => {
    const writes: string[] = [];
    mockApi((path) => {
      writes.push(path);
      return Promise.resolve();
    });
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });
    await user.click(editButton());

    await user.click(screen.getByRole('button', { name: 'Elimina immagine' }));
    await user.click(screen.getByRole('button', { name: 'Elimina' }));

    await waitFor(() => expect(writes).toContain(`${DOC}/images/image-1`));
  });

  it('shows the image being deleted as busy while it saves', async () => {
    let resolveDelete: (value: unknown) => void = () => {};
    mockApi(() => new Promise((resolve) => (resolveDelete = resolve)));
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });
    await user.click(editButton());

    await user.click(screen.getByRole('button', { name: 'Elimina immagine' }));
    await user.click(screen.getByRole('button', { name: 'Elimina' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Elimina immagine' })).toHaveAttribute(
        'data-loading',
        'true',
      ),
    );
    resolveDelete(undefined);
  });

  it('shows the favorite button as busy while it saves', async () => {
    routes.document = rawDocument({
      owner_ids: ['user-1'],
      images: [rawImage({ id: 'image-2', is_favorite: false })],
    });
    let resolveFavorite: (value: unknown) => void = () => {};
    mockApi(() => new Promise((resolve) => (resolveFavorite = resolve)));
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });

    await user.click(screen.getByRole('button', { name: 'Usa come immagine principale' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Usa come immagine principale' })).toHaveAttribute(
        'data-loading',
        'true',
      ),
    );
    resolveFavorite(routes.document);
  });
});

describe('Owners', () => {
  it('names the current Owners', async () => {
    render();

    await screen.findByRole('heading', { name: 'Il Cancello' });
    const owners = screen.getByText('Owner').parentElement as HTMLElement;
    expect(within(owners).getByText('Io')).toBeInTheDocument();
  });

  it('adds an Owner', async () => {
    routes.members = [
      rawMember({ user_id: 'user-1', display_name: 'Io' }),
      rawMember({ user_id: 'user-2', display_name: 'Altro', email: 'altro@example.com' }),
    ];
    const writes: string[] = [];
    mockApi((path) => {
      writes.push(path);
      return Promise.resolve(routes.document);
    });
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });

    await user.click(screen.getByRole('button', { name: 'Aggiungi Owner' }));
    await user.click(screen.getByRole('combobox', { name: 'Aggiungi Owner' }));
    await user.click(screen.getByRole('option', { name: 'Altro' }));
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));

    await waitFor(() => expect(writes).toContain(`${DOC}/owners/user-2`));
  });

  it('removes an Owner', async () => {
    const writes: string[] = [];
    mockApi((path) => {
      writes.push(path);
      return Promise.resolve(routes.document);
    });
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });

    await user.click(screen.getByRole('button', { name: 'Rimuovi Owner Io' }));

    await waitFor(() => expect(writes).toContain(`${DOC}/owners/user-1`));
  });

  it('offers no Owner controls to a non-Owner', async () => {
    routes.document = rawDocument({ owner_ids: ['user-2'] });
    routes.members = [rawMember({ user_id: 'user-1', role: 'player' })];
    render();

    await screen.findByRole('heading', { name: 'Il Cancello' });
    expect(screen.queryByRole('button', { name: 'Aggiungi Owner' })).not.toBeInTheDocument();
  });
});

describe('Played by', () => {
  it('links a player, making them an Owner by default', async () => {
    routes.members = [
      rawMember({ user_id: 'user-1', display_name: 'Io' }),
      rawMember({ user_id: 'user-2', display_name: 'Altro', email: 'altro@example.com' }),
    ];
    const writes: unknown[] = [];
    fetchMock.mockImplementation((path: string, init?: { method?: string; json?: unknown }) => {
      if (init?.method) {
        writes.push([path, init.json]);
        return Promise.resolve(rawDocument({ played_by: 'user-2' }));
      }
      if (path === '/rooms/room-1/members') return Promise.resolve(routes.members);
      if (path === '/rooms/room-1/characters/mine' || path === `${DOC}/comments`) {
        return Promise.resolve([]);
      }
      return Promise.resolve(routes.document);
    });
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });

    await user.click(screen.getByRole('button', { name: 'Scegli il giocatore' }));
    await user.click(screen.getByRole('combobox', { name: 'Scegli il giocatore' }));
    await user.click(screen.getByRole('option', { name: 'Altro' }));
    await user.click(screen.getByRole('button', { name: 'Imposta giocatore' }));

    await waitFor(() =>
      expect(writes).toContainEqual([`${DOC}/player`, { user_id: 'user-2', add_as_owner: true }]),
    );
  });

  it('unlinks the player', async () => {
    routes.document = rawDocument({ owner_ids: ['user-1'], played_by: 'user-1' });
    const writes: unknown[] = [];
    fetchMock.mockImplementation((path: string, init?: { method?: string; json?: unknown }) => {
      if (init?.method) {
        writes.push([path, init.json]);
        return Promise.reject(new Error('no'));
      }
      if (path === '/rooms/room-1/members') return Promise.resolve(routes.members);
      if (path === '/rooms/room-1/characters/mine' || path === `${DOC}/comments`) {
        return Promise.resolve([]);
      }
      return Promise.resolve(routes.document);
    });
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });

    await user.click(screen.getByRole('button', { name: 'Scollega Io' }));

    await waitFor(() =>
      expect(writes).toContainEqual([`${DOC}/player`, { user_id: null, add_as_owner: false }]),
    );
    // A refused change is reported, like every other Owner action.
    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });

  it('reports a refused link', async () => {
    routes.members = [rawMember({ user_id: 'user-1', display_name: 'Io' })];
    mockApi(() => Promise.reject(new Error('not a member')));
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });

    await user.click(screen.getByRole('button', { name: 'Scegli il giocatore' }));
    await user.click(screen.getByRole('combobox', { name: 'Scegli il giocatore' }));
    await user.click(screen.getByRole('option', { name: 'Io' }));
    await user.click(screen.getByRole('button', { name: 'Imposta giocatore' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });
});

describe('mentions', () => {
  // The provider feeds MentionText, so a `#Name` in the description that
  // resolves against this Room becomes a link.
  it('links a mention in the description', async () => {
    routes.document = rawDocument({
      owner_ids: ['user-1'],
      description: 'Accanto a #Luoghi.',
    });
    render();

    await screen.findByRole('heading', { name: 'Il Cancello' });

    // `findBy*` waits and then throws if the mention never renders. The
    // earlier `queryBy* ... toBeDefined()` could not fail: a missing element
    // comes back as `null`, which is defined.
    const mention = await screen.findByTestId('tag-mention');
    expect(mention).toHaveTextContent('#Luoghi');
    expect(mention.closest('a')).toHaveAttribute('href', '/rooms/room-1/documents?tag=tag-1');
  });
});

// Spec 12: Notes are paragraphs under the description. The backend leaves out
// the ones this viewer may not see, and the page shows exactly what it gets.
describe('Notes', () => {
  const two = [
    rawNote(),
    rawNote({ id: 'note-2', title: 'Trappola', description: 'Un dardo avvelenato.', position: 1 }),
  ];

  it('shows each Note under the description, in the order the backend sent them', async () => {
    routes.document = rawDocument({ owner_ids: ['user-1'], notes: two });
    render();

    await screen.findByRole('heading', { name: 'Il Cancello' });
    const headings = screen
      .getAllByTestId('note-item')
      .map((note) => within(note).getByRole('heading', { level: 2 }).textContent);
    expect(headings).toEqual(['Porta segreta', 'Trappola']);
    expect(screen.getByText('Dietro la libreria.')).toBeInTheDocument();
    expect(screen.getByText('Un dardo avvelenato.')).toBeInTheDocument();
    const description = screen.getByText('Una porta di pietra.');
    const first = screen.getByRole('heading', { name: 'Porta segreta' });
    expect(
      description.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // A Note hidden from the viewer is simply not in the response.
  it('shows no trace of a Note the backend left out', async () => {
    routes.document = rawDocument({
      owner_ids: ['user-2'],
      notes: [rawNote({ can_edit: false, can_delete: false })],
    });
    routes.members = [rawMember({ user_id: 'user-1', role: 'player' })];
    render();

    await screen.findByRole('heading', { name: 'Il Cancello' });
    expect(screen.getAllByTestId('note-item')).toHaveLength(1);
    expect(screen.queryByText(/Trappola/)).not.toBeInTheDocument();
  });

  it('looks like before for a reader of a Document with no Notes', async () => {
    routes.document = rawDocument({ owner_ids: ['user-2'], notes: [] });
    routes.members = [rawMember({ user_id: 'user-1', role: 'player' })];
    render();

    await screen.findByRole('heading', { name: 'Il Cancello' });
    expect(screen.queryAllByTestId('note-item')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Aggiungi Nota' })).not.toBeInTheDocument();
  });

  it('offers adding a Note to an Owner and to the Master', async () => {
    render();
    expect(await screen.findByRole('button', { name: 'Aggiungi Nota' })).toBeInTheDocument();
  });

  it('offers adding a Note to the Master without an Owner row', async () => {
    routes.document = rawDocument({ owner_ids: ['user-2'] });
    routes.members = [rawMember({ user_id: 'user-1', role: 'master' })];
    render();

    expect(await screen.findByRole('button', { name: 'Aggiungi Nota' })).toBeInTheDocument();
  });

  it('withholds it from a Player who is not an Owner', async () => {
    routes.document = rawDocument({ owner_ids: ['user-2'] });
    routes.members = [rawMember({ user_id: 'user-1', role: 'player' })];
    render();

    await screen.findByRole('heading', { name: 'Il Cancello' });
    expect(screen.queryByRole('button', { name: 'Aggiungi Nota' })).not.toBeInTheDocument();
  });

  it('resolves a mention in a Note against the Room, like the description', async () => {
    routes.document = rawDocument({
      owner_ids: ['user-1'],
      notes: [rawNote({ description: 'Vedi #Luoghi e #Il Cancello.' })],
    });
    render();

    const tag = await screen.findByTestId('tag-mention');
    expect(tag.closest('a')).toHaveAttribute('href', '/rooms/room-1/documents?tag=tag-1');
    expect(screen.getByTestId('document-mention').closest('a')).toHaveAttribute(
      'href',
      '/rooms/room-1/documents/doc-1',
    );
  });

  // VR-07: a Document absent from the viewer's list stays plain text.
  it('leaves a mention of a Document the viewer cannot see as plain text', async () => {
    routes.document = rawDocument({
      owner_ids: ['user-1'],
      notes: [rawNote({ description: 'Ricorda #Cripta Segreta.' })],
    });
    render();

    await screen.findByText(/Ricorda #Cripta Segreta\./);
    expect(screen.queryByTestId('document-mention')).not.toBeInTheDocument();
  });

  it('adds a Note and reloads the Document', async () => {
    const writes: string[] = [];
    mockApi((path) => {
      writes.push(path);
      return Promise.resolve(rawNote());
    });
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Aggiungi Nota' }));
    await user.type(screen.getByRole('textbox', { name: /Titolo/ }), 'Trappola');
    await user.click(screen.getAllByRole('button', { name: 'Aggiungi Nota' })[0]);

    await waitFor(() => expect(writes).toEqual([`${DOC}/notes`]));
  });
});

// Spec 16: a Document's PDFs, sent inside the single-Document response.
describe('Files', () => {
  // VR-12: a reader of the Document sees its files, without managing them.
  it('lists the files to a reader who is not an Owner, without upload', async () => {
    routes.document = rawDocument({
      owner_ids: ['user-2'],
      files: [rawDocumentFile({ can_delete: false })],
    });
    routes.members = [rawMember({ user_id: 'user-1', role: 'player' })];
    render();

    expect(await screen.findByText('Scheda di Aria.pdf')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Scarica Scheda di Aria.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carica PDF' })).not.toBeInTheDocument();
  });

  it('offers the upload to an Owner', async () => {
    render();

    expect(await screen.findByRole('button', { name: 'Carica PDF' })).toBeInTheDocument();
  });
  it('leaves the files row out for a reader when there are none', async () => {
    routes.document = rawDocument({ owner_ids: ['user-2'] });
    routes.members = [rawMember({ user_id: 'user-1', role: 'player' })];
    render();

    await screen.findByRole('heading', { name: 'Il Cancello' });
    expect(screen.queryByText('File')).not.toBeInTheDocument();
  });
});

// The info panel (player, Owners, PDFs) sits under the images, or takes their
// place on the right, narrower, when there are none (index.css does the rest).
describe('info panel', () => {
  it('sits in the aside under the images', async () => {
    routes.document = rawDocument({ owner_ids: ['user-1'], images: [rawImage({ id: 'image-1' })] });
    render();

    await screen.findByRole('heading', { name: 'Il Cancello' });
    const aside = screen.getByText('Owner').closest('.document-body-aside') as HTMLElement;
    expect(aside.querySelector('img')).toBeInTheDocument();
    expect(aside).not.toHaveAttribute('data-narrow');
  });

  it('narrows the aside when there are no images', async () => {
    routes.document = rawDocument({ owner_ids: ['user-1'], images: [] });
    render();

    await screen.findByRole('heading', { name: 'Il Cancello' });
    expect(screen.getByText('Owner').closest('.document-body-aside')).toHaveAttribute(
      'data-narrow',
    );
  });
});

describe('promoting a Comment (spec 19c)', () => {
  const PROMOTE = `${DOC}/comments/comment-1/promote`;
  const promoteCall = () => fetchMock.mock.calls.find(([path]) => path === PROMOTE);

  beforeEach(() => {
    routes.members = [
      rawMember({ user_id: 'user-1', display_name: 'Io' }),
      rawMember({ user_id: 'user-2', display_name: 'Bruno' }),
    ];
    routes.comments = [rawComment({ body: 'Il sigillo è rotto.', can_promote: true })];
    vi.mocked(notifySuccess).mockClear();
    mockApi((path) =>
      Promise.resolve(
        path === PROMOTE
          ? rawComment({ promoted_at: '2026-10-03T12:00:00Z', promoted_to: 'description' })
          : rawDocument({ owner_ids: ['user-1'] }),
      ),
    );
  });

  async function startPromotion(target: 'Nella descrizione' | 'In un nuovo Documento') {
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Promuovi' }));
    await user.click(await screen.findByRole('menuitem', { name: target }));
    return user;
  }

  it("opens the editor with the Comment's text added to the description", async () => {
    await startPromotion('Nella descrizione');

    expect(screen.getByText(/Il testo del commento è stato aggiunto/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Descrizione/ })).toHaveValue(
      'Una porta di pietra.\n\nIl sigillo è rotto.',
    );
  });

  it('keeps the edits in progress when promoting into an open editor', async () => {
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });
    await user.click(screen.getAllByRole('button', { name: 'Modifica' })[0]);
    await user.type(screen.getByRole('textbox', { name: /^Nome/ }), ' antico');

    await user.click(await screen.findByRole('button', { name: 'Promuovi' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Nella descrizione' }));

    expect(screen.getByRole('textbox', { name: /^Nome/ })).toHaveValue('Il Cancello antico');
    expect(screen.getByRole('combobox', { name: /Descrizione/ })).toHaveValue(
      'Una porta di pietra.\n\nIl sigillo è rotto.',
    );
    expect(screen.getByText(/Il testo del commento è stato aggiunto/)).toBeInTheDocument();
  });

  it('saves the description, then records the promotion', async () => {
    const user = await startPromotion('Nella descrizione');

    await user.click(screen.getByRole('button', { name: 'Salva modifiche' }));

    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Commento promosso'));
    expect(fetchMock).toHaveBeenCalledWith(DOC, {
      method: 'PATCH',
      json: expect.objectContaining({ description: 'Una porta di pietra.\n\nIl sigillo è rotto.' }),
    });
    expect(promoteCall()?.[1]).toEqual({
      method: 'POST',
      json: { target: 'description', confirm_widening: false },
    });
    expect(screen.queryByRole('textbox', { name: /^Nome/ })).not.toBeInTheDocument();
  });

  it('asks before showing a narrower Comment to more people', async () => {
    routes.comments = [
      rawComment({ body: 'Il sigillo è rotto.', visibility: 'private', can_promote: true }),
    ];
    const user = await startPromotion('Nella descrizione');

    await user.click(screen.getByRole('button', { name: 'Salva modifiche' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Il testo diventerà visibile a più persone',
    });
    expect(within(dialog).getByText(/Bruno\./)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    expect(promoteCall()).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'Salva modifiche' }));
    await user.click(await screen.findByRole('button', { name: 'Promuovi comunque' }));

    await waitFor(() => expect(promoteCall()).toBeDefined());
    expect(promoteCall()?.[1]).toMatchObject({ json: { confirm_widening: true } });
  });

  it('gives the promotion up on cancel', async () => {
    const user = await startPromotion('Nella descrizione');

    await user.click(screen.getByRole('button', { name: 'Annulla' }));

    expect(screen.queryByText(/Il testo del commento è stato aggiunto/)).not.toBeInTheDocument();
    // The Document's own, ahead of the Comment's.
    await user.click(screen.getAllByRole('button', { name: 'Modifica' })[0]);
    expect(screen.getByRole('combobox', { name: /Descrizione/ })).toHaveValue(
      'Una porta di pietra.',
    );
    expect(promoteCall()).toBeUndefined();
  });

  it('gives the promotion up from the header too', async () => {
    const user = await startPromotion('Nella descrizione');

    await user.click(screen.getByRole('button', { name: 'Annulla modifiche' }));

    expect(screen.queryByText(/Il testo del commento è stato aggiunto/)).not.toBeInTheDocument();
    expect(promoteCall()).toBeUndefined();
  });

  it('reports a refused promotion', async () => {
    mockApi((path) =>
      path === PROMOTE
        ? Promise.reject(new Error('The Comment was deleted'))
        : Promise.resolve(rawDocument({ owner_ids: ['user-1'] })),
    );
    const user = await startPromotion('Nella descrizione');

    await user.click(screen.getByRole('button', { name: 'Salva modifiche' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(vi.mocked(notifyError).mock.calls[0][0]).toEqual(new Error('The Comment was deleted'));
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it('opens and closes the new-Document form', async () => {
    const user = await startPromotion('In un nuovo Documento');

    const dialog = await screen.findByRole('dialog', { name: 'Promuovi in un nuovo Documento' });
    expect(within(dialog).getByRole('combobox', { name: /Descrizione/ })).toHaveValue(
      'Il sigillo è rotto.',
    );
    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Promuovi in un nuovo Documento' }),
      ).not.toBeInTheDocument(),
    );
  });
});

// Spec 20 Decision 6: "Mentioned in", between the Notes and the Comments.
describe('DocumentDetailPage backlinks', () => {
  it('shows where the Document is mentioned, before the Comments', async () => {
    routes.backlinks = [
      {
        document_id: 'doc-2',
        document_name: 'La Locanda',
        mentions: [
          {
            kind: 'description',
            note_id: null,
            note_title: null,
            comment_id: null,
            comment_author_id: null,
            excerpt: 'Vai al #Il Cancello',
          },
        ],
      },
    ];
    render();

    const backlinks = await screen.findByTestId('backlinks');
    expect(within(backlinks).getByRole('link', { name: 'La Locanda' })).toBeInTheDocument();
    const comments = screen.getByText('Commenti');
    expect(backlinks.compareDocumentPosition(comments)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

// Spec 22: the Master reveals the Document with Notes picked in the same
// step; a Document the visit opened as revealed is marked.
describe('revealing the Document', () => {
  beforeEach(() => {
    vi.mocked(notifySuccess).mockClear();
    routes.document = rawDocument({
      visibility: 'master',
      owner_ids: [],
      notes: [rawNote({ visibility: 'master' })],
    });
    routes.members = [
      rawMember({ user_id: 'user-1', display_name: 'Io', role: 'master', is_admin: true }),
      rawMember({ user_id: 'user-2', display_name: 'Alice' }),
    ];
  });

  it('reveals it to the Room with a Note picked', async () => {
    const writes = vi.fn((_path: string) => Promise.resolve(routes.document));
    mockApi(writes);
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Rivela: Il Cancello' }));
    const dialog = screen.getByRole('dialog', { name: 'Rivela "Il Cancello"' });
    await user.click(within(dialog).getByRole('radio', { name: 'A tutta la Stanza' }));
    expect(within(dialog).getByText('Ottengono accesso: Alice')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Porta segreta' }));
    await user.click(within(dialog).getByRole('button', { name: 'Rivela' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`${DOC}/reveal`, {
        method: 'POST',
        json: { to_room: true, user_ids: [], note_ids: ['note-1'] },
      }),
    );
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Rivelato.'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('reports a refused Reveal and closes on cancel', async () => {
    mockApi(() => Promise.reject(new Error('no')));
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Rivela: Il Cancello' }));
    await user.click(screen.getByRole('radio', { name: 'A tutta la Stanza' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Rivela' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('offers no Reveal to a Player', async () => {
    sessionMock.mockReturnValue({ session: fakeSession('user-2'), loading: false } as SessionState);
    render();

    expect(await screen.findByRole('heading', { name: 'Il Cancello' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Rivela/ })).not.toBeInTheDocument();
  });

  it('marks the Document the visit opened as revealed', async () => {
    fetchMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === `${DOC}/read`) {
        return Promise.resolve(
          rawDocumentRead({ revealed: { document: true, note_ids: [], comment_ids: [] } }),
        );
      }
      if (init?.method) return Promise.resolve();
      if (path === `${DOC}/comments`) return Promise.resolve([]);
      if (path === '/rooms/room-1/members') return Promise.resolve(routes.members);
      if (path === '/rooms/room-1/characters/mine') return Promise.resolve([]);
      return Promise.resolve(routes.document);
    });
    render();

    expect(await screen.findByText('Rivelato')).toBeInTheDocument();
  });
});

// Spec 22b: the Master previewing the Room as a member changes nothing, so
// the page offers no write control, whatever the member could do, and the
// visit isn't recorded.
describe('previewing as a member', () => {
  it('is read-only', async () => {
    routes.document = rawDocument({
      visibility: 'master',
      owner_ids: ['user-1', 'user-2'],
      notes: [rawNote({ visibility: 'master' })],
    });
    routes.members = [
      rawMember({ user_id: 'user-1', display_name: 'Io', role: 'master', is_admin: true }),
      rawMember({ user_id: 'user-2', display_name: 'Alice' }),
    ];
    routes.comments = [
      rawComment({
        author_id: 'user-2',
        visibility: 'master',
        can_pin: true,
        can_resolve: true,
        can_promote: true,
        reactions: [{ emoji: '👍', count: 1, reacted_by_me: true, user_ids: ['user-2'] }],
      }),
    ];
    renderWithProviders(
      <Routes>
        <Route path="/rooms/:roomId/documents/:documentId" element={<DocumentDetailPage />} />
      </Routes>,
      {
        route: DOC,
        wrapper: ({ children }) => (
          <ViewAsContext value={{ roomId: 'room-1', userId: 'user-2' }}>{children}</ViewAsContext>
        ),
      },
    );

    expect(await screen.findByText('Ricordate il sigillo.')).toBeInTheDocument();
    expect(screen.getByText('Porta segreta')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifica' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Rivela/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nota: Porta segreta/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aggiungi Nota' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Storico/ })).not.toBeInTheDocument();
    for (const action of [
      'Rispondi',
      'Fissa',
      'Segna come risolto',
      'Promuovi',
      'Elimina',
      'Aggiungi una reazione',
    ]) {
      expect(screen.queryByRole('button', { name: action })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /^👍, 1 reazione/ })).toBeDisabled();
    expect(screen.queryByTestId('new-comment')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(`${DOC}/read`, expect.anything());
  });
});
