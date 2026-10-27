import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '../hooks/useSession';
import { renderWithProviders } from './utils';
import App from '../App';

// Each page has its own tests; here only the routing table is under test, so
// the pages are stubbed down to a marker.
vi.mock('../pages/HomePage', () => ({ HomePage: () => <div>home</div> }));
vi.mock('../pages/MyRoomsPage', () => ({ MyRoomsPage: () => <div>my rooms</div> }));
vi.mock('../pages/AccountPage', () => ({ AccountPage: () => <div>account</div> }));
vi.mock('../pages/AcceptInvitePage', () => ({ AcceptInvitePage: () => <div>invite</div> }));
vi.mock('../pages/AddFriendPage', () => ({ AddFriendPage: () => <div>add friend</div> }));
vi.mock('../pages/RoomSetupPage', () => ({
  RoomSetupPage: () => <div>setup</div>,
  RoomMembersRedirect: () => <div>members redirect</div>,
}));
vi.mock('../pages/RoomDocumentsPage', () => ({ RoomDocumentsPage: () => <div>documents</div> }));
vi.mock('../pages/DocumentDetailPage', () => ({ DocumentDetailPage: () => <div>detail</div> }));
vi.mock('../pages/PrivacyPage', () => ({ PrivacyPage: () => <div>privacy</div> }));
vi.mock('../pages/DemoPage', () => ({ DemoPage: () => <div>demo</div> }));
vi.mock('../pages/RoomMapsPage', () => ({ RoomMapsPage: () => <div>maps</div> }));
vi.mock('../pages/RelationshipMapPage', () => ({ RelationshipMapPage: () => <div>map</div> }));
vi.mock('../pages/SessionZeroPage', () => ({ SessionZeroPage: () => <div>session zero</div> }));
vi.mock('../pages/MentionMapPage', () => ({ MentionMapPage: () => <div>mention map</div> }));
vi.mock('../hooks/useSession', () => ({ useSession: vi.fn() }));

beforeEach(() => {
  vi.mocked(useSession).mockReturnValue({ session: null, loading: false } as ReturnType<
    typeof useSession
  >);
});

describe('App routes', () => {
  it.each([
    ['/', 'home'],
    ['/rooms', 'my rooms'],
    ['/account', 'account'],
    ['/invite/ABC123', 'invite'],
    ['/friends/add/FRIEND1', 'add friend'],
    ['/rooms/room-1/setup', 'setup'],
    ['/rooms/room-1/members', 'members redirect'],
    ['/rooms/room-1/documents', 'documents'],
    ['/rooms/room-1/documents/doc-1', 'detail'],
    ['/privacy', 'privacy'],
    ['/demo', 'demo'],
    ['/rooms/room-1/documents/doc-1/mention-map', 'mention map'],
    ['/rooms/room-1/maps', 'maps'],
    ['/rooms/room-1/maps/map-1', 'map'],
    ['/rooms/room-1/session-zero', 'session zero'],
  ])('renders %s', async (route, marker) => {
    renderWithProviders(<App />, { route });

    // Pages other than the home page are lazy-loaded.
    expect(await screen.findByText(marker)).toBeInTheDocument();
  });

  // The Document detail route is nested under the Documents route; the more
  // specific one has to win rather than both matching.
  it('prefers the Document detail route over the Documents list', async () => {
    renderWithProviders(<App />, { route: '/rooms/room-1/documents/doc-1' });

    expect(await screen.findByText('detail')).toBeInTheDocument();
    expect(screen.queryByText('documents')).not.toBeInTheDocument();
  });

  it('renders nothing for an unknown route', () => {
    renderWithProviders(<App />, { route: '/nope' });

    expect(screen.queryByText('home')).not.toBeInTheDocument();
  });
});
