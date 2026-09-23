import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { notifyError } from '../lib/notify';
import { useSession } from '../hooks/useSession';
import { fakeSession, rawAccount, rawDocument, rawImage, rawMember } from '../test/fixtures';
import { renderWithProviders } from '../test/utils';
import { DocumentDetailPage } from './DocumentDetailPage';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock('../hooks/useSession', () => ({ useSession: vi.fn() }));

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
}

const routes: Routes = { document: rawDocument(), members: [], comments: [] };

function mockApi(onWrite: (path: string) => Promise<unknown> = () => Promise.resolve()) {
  fetchMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method) return onWrite(path);
    if (path === DOC) return Promise.resolve(routes.document);
    if (path === `${DOC}/comments`) return Promise.resolve(routes.comments);
    if (path === '/rooms/room-1/documents') return Promise.resolve([routes.document]);
    if (path === '/rooms/room-1/tags') return Promise.resolve(tags);
    if (path === '/rooms/room-1/members') return Promise.resolve(routes.members);
    if (path === '/account') return Promise.resolve(rawAccount());
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
  fetchMock.mockReset();
  vi.mocked(notifyError).mockClear();
  sessionMock.mockReturnValue({ session: fakeSession('user-1'), loading: false } as SessionState);
  mockApi();
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

  it('links back to the Room\'s Documents', async () => {
    render();
    await screen.findByRole('heading', { name: 'Il Cancello' });

    expect(screen.getByRole('link', { name: 'Documenti' })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents',
    );
  });

  it('shows the Comment section', async () => {
    render();

    expect(await screen.findByRole('heading', { name: 'Commenti' })).toBeInTheDocument();
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

  // The image controls belong to edit mode, not the read view.
  it('offers image uploads only while editing', async () => {
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });

    expect(screen.queryByText('Aggiungi immagini')).not.toBeInTheDocument();

    await user.click(editButton());
    expect(screen.getByText('Aggiungi immagini')).toBeInTheDocument();
  });
});

describe('adding images while editing', () => {
  it('uploads a picked file', async () => {
    const writes: string[] = [];
    mockApi((path) => {
      writes.push(path);
      return Promise.resolve(routes.document);
    });
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });
    await user.click(editButton());

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
    await user.click(editButton());

    await user.type(
      screen.getByPlaceholderText("https://… URL dell'immagine"),
      'https://example.com/map.png',
    );
    await user.click(screen.getByRole('button', { name: 'Aggiungi da URL' }));

    await waitFor(() => expect(writes).toContain(`${DOC}/images/from-url`));
  });

  it('reports a rejected upload', async () => {
    mockApi(() => Promise.reject(new Error('Too many images')));
    const { user } = render();
    await screen.findByRole('heading', { name: 'Il Cancello' });
    await user.click(editButton());

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
});

describe('Owners', () => {
  it('names the current Owners', async () => {
    render();

    await screen.findByRole('heading', { name: 'Il Cancello' });
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Io')).toBeInTheDocument();
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

    await user.click(screen.getByRole('combobox', { name: '' }));
    await user.click(screen.getByRole('option', { name: 'Altro (altro@example.com)' }));
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));

    await waitFor(() => expect(writes).toContain(`${DOC}/owners/user-2`));
  });

  it('offers no Owner controls to a non-Owner', async () => {
    routes.document = rawDocument({ owner_ids: ['user-2'] });
    routes.members = [rawMember({ user_id: 'user-1', role: 'player' })];
    render();

    await screen.findByRole('heading', { name: 'Il Cancello' });
    expect(screen.queryByRole('button', { name: 'Aggiungi' })).not.toBeInTheDocument();
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
