// The thin layout wrappers, covered together: each is a handful of lines
// with one thing worth asserting, and a file apiece would be noise.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { rawAccount, rawDirectInvitation, rawFriend, rawFriends, rawMyReveal } from '../fixtures';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { theme } from '../../theme/theme';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient, renderWithProviders } from '../utils';
import { AppHeader } from '../../components/AppHeader';
import { PageCard } from '../../components/PageCard';
import { PageLayout } from '../../components/PageLayout';
import { AccountSection } from '../../components/account/AccountSection';
import { AccountButton } from '../../components/account/AccountButton';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}));

const fetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string) =>
    path.endsWith('/tags') ? Promise.resolve([]) : Promise.resolve(rawAccount()),
  );
  navigate.mockReset();
  // jsdom's `window.history` persists across tests in this file (MemoryRouter
  // never touches it), so each test starts from a clean, "no app history" state.
  window.history.replaceState(null, '', '/');
});

const oneTag = [{ id: 'tag-npc', name: 'NPC', category: null }];

describe('PageCard', () => {
  it('renders its content', () => {
    renderWithProviders(
      <PageCard>
        <p>Contenuto</p>
      </PageCard>,
    );

    expect(screen.getByText('Contenuto')).toBeInTheDocument();
  });
});

describe('PageLayout', () => {
  it('renders the back button (forwarded to the header) and the content', () => {
    renderWithProviders(
      <PageLayout backTo="/rooms/room-1/documents" backLabel="Documenti">
        <p>Contenuto</p>
      </PageLayout>,
    );

    expect(screen.getByRole('button', { name: 'Documenti' })).toBeInTheDocument();
    expect(screen.getByText('Contenuto')).toBeInTheDocument();
  });

  it('includes the app header', () => {
    renderWithProviders(
      <PageLayout backTo="/" backLabel="Indietro">
        <p>Contenuto</p>
      </PageLayout>,
    );

    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('wraps the page body in the main landmark', () => {
    renderWithProviders(
      <PageLayout backTo="/" backLabel="Indietro">
        <p>Contenuto</p>
      </PageLayout>,
    );

    expect(within(screen.getByRole('main')).getByText('Contenuto')).toBeInTheDocument();
  });

  it('pins the app header to the top of the page', () => {
    renderWithProviders(
      <PageLayout backTo="/" backLabel="Indietro">
        <p>Contenuto</p>
      </PageLayout>,
    );

    // `.app-header` (index.css) makes it sticky at the top.
    expect(screen.getByRole('banner')).toHaveClass('app-header');
  });

  it('hides the app header while scrolling down and brings it back on scroll up', async () => {
    const scrollTo = (y: number) =>
      act(() => {
        Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
        fireEvent.scroll(window);
      });
    renderWithProviders(
      <PageLayout backTo="/" backLabel="Indietro">
        <p>Contenuto</p>
      </PageLayout>,
    );
    const header = screen.getByRole('banner');
    expect(header).not.toHaveAttribute('data-hidden');

    scrollTo(100);
    scrollTo(400);
    await waitFor(() => expect(header).toHaveAttribute('data-hidden'));

    // The first event up only registers the turn; the next one shows it.
    scrollTo(390);
    scrollTo(380);
    await waitFor(() => expect(header).not.toHaveAttribute('data-hidden'));

    scrollTo(0);
  });

  // Spec 44: the Room's Index is a tab on the left edge of a Room page.
  it('shows the Room Index tab on a Room page', () => {
    renderWithProviders(
      <PageLayout backTo="/" backLabel="Indietro" roomId="room-1">
        <p>Contenuto</p>
      </PageLayout>,
    );

    expect(screen.getByRole('button', { name: /Apri l.indice della Stanza/ })).toBeInTheDocument();
  });

  it('shows no Room Index tab without a Room', () => {
    renderWithProviders(
      <PageLayout backTo="/" backLabel="Indietro">
        <p>Contenuto</p>
      </PageLayout>,
    );

    expect(screen.queryByRole('button', { name: /indice della Stanza/ })).not.toBeInTheDocument();
  });

  it('opens the Room Index from the tab and closes it when a Tag is picked', async () => {
    fetchMock.mockImplementation((path: string) =>
      path.endsWith('/tags') ? Promise.resolve(oneTag) : Promise.resolve(path.endsWith('/maps') ? [] : rawAccount()),
    );
    renderWithProviders(
      <PageLayout backTo="/" backLabel="Indietro" roomId="room-1">
        <p>Contenuto</p>
      </PageLayout>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Apri l.indice della Stanza/ }));
    await user.click(await screen.findByText('#NPC'));

    await waitFor(() => expect(screen.queryByText('Indice della Stanza')).not.toBeInTheDocument());
  });
});

describe('AppHeader', () => {
  it('links the app name back to the Rooms list', () => {
    renderWithProviders(<AppHeader />);

    expect(screen.getByRole('link', { name: 'Ex Libris' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('shows the account button', () => {
    renderWithProviders(<AppHeader />);

    expect(screen.getByRole('link', { name: 'Il tuo account' })).toBeInTheDocument();
  });

  // Given by every nested page through PageLayout; the Rooms list
  // (`MyRoomsPage`) renders AppHeader without it since it has no parent.
  it('offers no back button without a backTo', () => {
    renderWithProviders(<AppHeader />);

    expect(screen.queryByRole('button', { name: /Indietro|Documenti/ })).not.toBeInTheDocument();
  });

  describe('with a back destination', () => {
    // Back is hierarchical: it climbs to the page's parent, never through the
    // browser history, so a map or a split view in between cannot derail it.
    it('goes up to backTo, replacing the current entry', async () => {
      renderWithProviders(<AppHeader backTo="/rooms/room-1/documents" backLabel="Documenti" />);
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Documenti' }));

      expect(navigate).toHaveBeenCalledWith('/rooms/room-1/documents', { replace: true });
    });

    it('returns to the page it was opened from, under a generic name', async () => {
      render(
        <MantineProvider theme={theme} forceColorScheme="dark" env="test">
          <QueryClientProvider client={createTestQueryClient()}>
            <MemoryRouter initialEntries={[{ pathname: '/x', state: { from: '/rooms/r1/maps/m1' } }]}>
              <AppHeader backTo="/rooms/room-1/documents" backLabel="Documenti" />
            </MemoryRouter>
          </QueryClientProvider>
        </MantineProvider>,
      );
      const user = userEvent.setup();

      expect(screen.queryByRole('button', { name: 'Documenti' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /Back|Indietro/ }));

      expect(navigate).toHaveBeenCalledWith('/rooms/r1/maps/m1', { replace: true });
    });

    it('ignores browser history even when there is some', async () => {
      window.history.pushState({ idx: 1 }, '', '/somewhere-else');
      renderWithProviders(<AppHeader backTo="/rooms/room-1/documents" backLabel="Documenti" />);
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Documenti' }));

      expect(navigate).not.toHaveBeenCalledWith(-1);
      expect(navigate).toHaveBeenCalledWith('/rooms/room-1/documents', { replace: true });
    });

  });

  // Spec 44: the Room's Index left the header for a tab on the page's edge.
  it('has no burger on a Room page', () => {
    renderWithProviders(<AppHeader roomId="room-1" />);

    expect(screen.queryByRole('button', { name: /indice/i })).not.toBeInTheDocument();
  });
});

describe('AccountButton', () => {
  it('links to the Account page', () => {
    renderWithProviders(<AccountButton />);

    expect(screen.getByRole('link', { name: 'Il tuo account' })).toHaveAttribute(
      'href',
      '/account',
    );
  });

  it('is not marked current on another page', () => {
    renderWithProviders(<AccountButton />, { route: '/rooms' });

    expect(screen.getByRole('link', { name: 'Il tuo account' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  // Friend requests received, Room invitations from Friends, and content
  // revealed to the user they haven't opened (spec 22).
  it('counts what waits on the Account page', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path === '/friends') {
        return Promise.resolve(
          rawFriends({ incoming: [rawFriend(), rawFriend({ friendship_id: 'friendship-2' })] }),
        );
      }
      if (path === '/invitations/mine') return Promise.resolve([rawDirectInvitation()]);
      if (path === '/reveals/mine') return Promise.resolve([rawMyReveal()]);
      return Promise.resolve(rawAccount());
    });

    renderWithProviders(<AccountButton />);

    const link = await screen.findByRole('link', { name: 'Il tuo account: 4 da vedere' });
    expect(within(link).getByText('4')).toBeInTheDocument();
  });

  it('shows no count when nothing waits', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path === '/friends') return Promise.resolve(rawFriends({ friends: [rawFriend()] }));
      if (path === '/invitations/mine') return Promise.resolve([]);
      return Promise.resolve(rawAccount());
    });

    renderWithProviders(<AccountButton />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/invitations/mine'));
    expect(screen.getByRole('link', { name: 'Il tuo account' })).toBeInTheDocument();
  });

  it('marks itself as the current page on /account', () => {
    renderWithProviders(<AccountButton />, { route: '/account' });

    expect(screen.getByRole('link', { name: 'Il tuo account' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('AccountSection', () => {
  it('titles the section and renders its content', () => {
    renderWithProviders(
      <AccountSection title="Profilo">
        <p>Contenuto</p>
      </AccountSection>,
    );

    expect(screen.getByRole('heading', { name: 'Profilo' })).toBeInTheDocument();
    expect(screen.getByText('Contenuto')).toBeInTheDocument();
  });

  it('adds a description when given one', () => {
    renderWithProviders(
      <AccountSection title="Profilo" description="Come ti vedono gli altri">
        <p>Contenuto</p>
      </AccountSection>,
    );

    expect(screen.getByText('Come ti vedono gli altri')).toBeInTheDocument();
  });
});
