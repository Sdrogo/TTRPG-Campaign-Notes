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

function renderPage(route: string, roomId: string | null = 'room-1', allowEmptySide = true) {
  renderWithProviders(
    <PageLayout backTo="/" backLabel="Indietro" roomId={roomId ?? undefined} allowEmptySide={allowEmptySide}>
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

  it('asks for a card while the pane is open with nothing picked', async () => {
    restore = matchMediaQueries([SPLIT_QUERY]);
    const user = renderPage('/rooms/room-1/maps/map-1?side=');
    expect(screen.getByText('Seleziona una card per vederne le info')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Chiudi il pannello' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('ignores an empty ?side= on a page that is not a map', () => {
    restore = matchMediaQueries([SPLIT_QUERY]);
    renderPage('/rooms/room-1/documents?side=', 'room-1', false);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('says when the Document is gone or hidden, and still closes', async () => {
    restore = matchMediaQueries([SPLIT_QUERY]);
    fetchMock.mockImplementation((path: string) =>
      path === '/rooms/room-1/documents/doc-9' ? Promise.reject(new Error('404')) : Promise.resolve([]),
    );
    const user = renderPage('/rooms/room-1/maps/map-1?side=doc-9');
    expect(await screen.findByText("Documento non trovato o non visibile.")).toBeInTheDocument();
    expect(screen.queryByText('Vista di doc-9')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Chiudi il pannello' }));
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('waits for the session before showing the Document', () => {
    restore = matchMediaQueries([SPLIT_QUERY]);
    sessionMock.mockReturnValue({ session: null, loading: true } as SessionState);
    renderPage('/rooms/room-1/maps/map-1?side=doc-2');
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(screen.queryByText('Vista di doc-2')).not.toBeInTheDocument();
  });

  it('opens the Document under the map on a phone, bringing the map to the top', async () => {
    // jsdom has no scrolling: the call is only recorded.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderWithProviders(
      <PageLayout backTo="/" backLabel="Indietro" roomId="room-1" allowEmptySide>
        <div data-split-anchor>La mappa</div>
      </PageLayout>,
      { route: '/rooms/room-1/maps/map-1?side=doc-2' },
    );
    expect(screen.getByRole('complementary', { name: 'Documento affiancato' })).toBeInTheDocument();
    expect(await screen.findByText('Vista di doc-2')).toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it('opens the Document under a page with no map to scroll to', async () => {
    renderPage('/rooms/room-1/maps/map-1?side=doc-2');
    expect(await screen.findByText('Vista di doc-2')).toBeInTheDocument();
  });

  it('keeps the whole width on a phone with nothing picked', () => {
    renderPage('/rooms/room-1/maps/map-1?side=');
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('keeps the whole width on a phone off a map page', () => {
    renderPage('/rooms/room-1/documents?side=doc-2', 'room-1', false);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('keeps the whole width outside a Room', () => {
    restore = matchMediaQueries([SPLIT_QUERY]);
    renderPage('/account?side=doc-2', null);
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });
});

describe('PageLayout with a map place beside the page (spec 50)', () => {
  let restore = () => {};
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue([]);
    sessionMock.mockReturnValue({ session: fakeSession('user-1'), loading: false } as SessionState);
  });
  afterEach(() => restore());

  const renderSide = (sideId: string) => (sideId.startsWith('place:') ? <p>Luogo {sideId}</p> : null);

  it('shows what the page renders for a place, beside it or under it on a phone', () => {
    restore = matchMediaQueries([SPLIT_QUERY]);
    renderWithProviders(
      <PageLayout backTo="/" backLabel="Indietro" roomId="room-1" allowEmptySide renderSide={renderSide}>
        <p>La mappa</p>
      </PageLayout>,
      { route: '/rooms/room-1/maps/map-1?side=place:pin:pin-2' },
    );
    expect(screen.getByText('Luogo place:pin:pin-2')).toBeInTheDocument();
    expect(screen.getByRole('separator')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/rooms/room-1/documents/place:pin:pin-2', expect.anything());
  });

  it('shows a place under the map on a phone', () => {
    restore = matchMediaQueries([]);
    renderWithProviders(
      <PageLayout backTo="/" backLabel="Indietro" roomId="room-1" allowEmptySide renderSide={renderSide}>
        <p>La mappa</p>
      </PageLayout>,
      { route: '/rooms/room-1/maps/map-1?side=place:area:area-2' },
    );
    expect(screen.getByText('Luogo place:area:area-2')).toBeInTheDocument();
  });

  it('keeps the whole width for a place on a page that cannot show it', () => {
    restore = matchMediaQueries([SPLIT_QUERY]);
    renderPage('/rooms/room-1/documents?side=place:pin:pin-2', 'room-1', false);
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });
});
