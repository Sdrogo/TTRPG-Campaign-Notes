import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from './hooks/useSession';
import { renderWithProviders } from './test/utils';
import App from './App';

// Each page has its own tests; here only the routing table is under test, so
// the pages are stubbed down to a marker.
vi.mock('./pages/HomePage', () => ({ HomePage: () => <div>home</div> }));
vi.mock('./pages/AccountPage', () => ({ AccountPage: () => <div>account</div> }));
vi.mock('./pages/AcceptInvitePage', () => ({ AcceptInvitePage: () => <div>invite</div> }));
vi.mock('./pages/RoomMembersPage', () => ({ RoomMembersPage: () => <div>members</div> }));
vi.mock('./pages/RoomDocumentsPage', () => ({ RoomDocumentsPage: () => <div>documents</div> }));
vi.mock('./pages/DocumentDetailPage', () => ({ DocumentDetailPage: () => <div>detail</div> }));
vi.mock('./hooks/useSession', () => ({ useSession: vi.fn() }));

beforeEach(() => {
  vi.mocked(useSession).mockReturnValue({ session: null, loading: false } as ReturnType<
    typeof useSession
  >);
});

describe('App routes', () => {
  it.each([
    ['/', 'home'],
    ['/account', 'account'],
    ['/invite/ABC123', 'invite'],
    ['/rooms/room-1/members', 'members'],
    ['/rooms/room-1/documents', 'documents'],
    ['/rooms/room-1/documents/doc-1', 'detail'],
  ])('renders %s', (route, marker) => {
    renderWithProviders(<App />, { route });

    expect(screen.getByText(marker)).toBeInTheDocument();
  });

  // The Document detail route is nested under the Documents route; the more
  // specific one has to win rather than both matching.
  it('prefers the Document detail route over the Documents list', () => {
    renderWithProviders(<App />, { route: '/rooms/room-1/documents/doc-1' });

    expect(screen.getByText('detail')).toBeInTheDocument();
    expect(screen.queryByText('documents')).not.toBeInTheDocument();
  });

  it('renders nothing for an unknown route', () => {
    renderWithProviders(<App />, { route: '/nope' });

    expect(screen.queryByText('home')).not.toBeInTheDocument();
  });
});
