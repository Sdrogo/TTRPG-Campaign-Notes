import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../utils';
import { matchMediaQueries } from '../media';
import { fakeSession, rawDocument } from '../fixtures';
import { apiFetch } from '../../lib/apiClient';
import { useSession } from '../../hooks/useSession';
import { SPLIT_QUERY } from '../../hooks/useSideDocument';
import { PageLayout } from '../../components/PageLayout';

vi.mock('../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../../hooks/useSession', () => ({ useSession: vi.fn() }));
// The Document's own page has its tests: here it only says which one it shows.
vi.mock('../../components/documents/DocumentView', () => ({
  DocumentView: ({ documentId }: { documentId: string }) => <p>Vista di {documentId}</p>,
}));

const fetchMock = vi.mocked(apiFetch);
const sessionMock = vi.mocked(useSession);
type SessionState = ReturnType<typeof useSession>;

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.search}</output>;
}

function renderPage(route: string, roomId: string | null = 'room-1') {
  renderWithProviders(
    <PageLayout backTo="/" backLabel="Indietro" roomId={roomId ?? undefined}>
      <p>La mappa</p>
      <Where />
    </PageLayout>,
    { route },
  );
  return userEvent.setup();
}

describe('PageLayout with a Document beside the page (spec 37)', () => {
  let restore = () => {};
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((path: string) =>
      Promise.resolve(path === '/rooms/room-1/documents/doc-2' ? rawDocument({ id: 'doc-2', name: 'Thorn' }) : []),
    );
    sessionMock.mockReturnValue({ session: fakeSession('user-1'), loading: false } as SessionState);
  });
  afterEach(() => restore());

  it('splits the page with the Document, which links to its page and closes', async () => {
    restore = matchMediaQueries([SPLIT_QUERY]);
    const user = renderPage('/rooms/room-1/maps/map-1?side=doc-2');
    const pane = screen.getByRole('complementary', { name: 'Documento affiancato' });
    expect(await screen.findByText('Thorn')).toBeInTheDocument();
    expect(screen.getByText('Vista di doc-2')).toBeInTheDocument();
    expect(screen.getByRole('separator')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apri il Documento' })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents/doc-2',
    );
    expect(pane).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Chiudi il pannello' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('');
    expect(screen.getByText('La mappa')).toBeInTheDocument();
  });

  it('waits for the session before showing the Document', () => {
    restore = matchMediaQueries([SPLIT_QUERY]);
    sessionMock.mockReturnValue({ session: null, loading: true } as SessionState);
    renderPage('/rooms/room-1/maps/map-1?side=doc-2');
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(screen.queryByText('Vista di doc-2')).not.toBeInTheDocument();
  });

  it('keeps the whole width on a phone, or outside a Room', () => {
    renderPage('/rooms/room-1/maps/map-1?side=doc-2');
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('keeps the whole width outside a Room', () => {
    restore = matchMediaQueries([SPLIT_QUERY]);
    renderPage('/account?side=doc-2', null);
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });
});
