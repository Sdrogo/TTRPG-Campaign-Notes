// The thin layout wrappers, covered together: each is a handful of lines
// with one thing worth asserting, and a file apiece would be noise.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { rawAccount, rawDirectInvitation, rawFriend, rawFriends } from '../fixtures';
import { renderWithProviders } from '../utils';
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

  it('pins the app header to the top of the page', () => {
    renderWithProviders(
      <PageLayout backTo="/" backLabel="Indietro">
        <p>Contenuto</p>
      </PageLayout>,
    );

    // `.app-header` (index.css) makes it sticky at the top.
    expect(screen.getByRole('banner')).toHaveClass('app-header');
  });

  it('forwards a given Room id to the header, offering the Glossary Index', () => {
    renderWithProviders(
      <PageLayout backTo="/" backLabel="Indietro" roomId="room-1">
        <p>Contenuto</p>
      </PageLayout>,
    );

    expect(screen.getByRole('button', { name: 'Apri indice dei Tag' })).toBeInTheDocument();
  });
});

describe('AppHeader', () => {
  it('links the app name back to the Rooms list', () => {
    renderWithProviders(<AppHeader />);

    expect(screen.getByRole('link', { name: 'TTRPG Campaign Notes' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('shows the account button', () => {
    renderWithProviders(<AppHeader />);

    expect(screen.getByRole('link', { name: 'Il tuo account' })).toBeInTheDocument();
  });

  // Spec 10: the Glossary/Tag index toggle only makes sense on a Room page.
  it('offers no Glossary Index toggle without a Room', () => {
    renderWithProviders(<AppHeader />);

    expect(screen.queryByRole('button', { name: /indice dei Tag/ })).not.toBeInTheDocument();
  });

  // Given by every nested page through PageLayout; the Rooms list
  // (`HomePage`) renders AppHeader without it since it's the app's own root.
  it('offers no back button without a backTo', () => {
    renderWithProviders(<AppHeader />);

    expect(screen.queryByRole('button', { name: /Indietro|Documenti/ })).not.toBeInTheDocument();
  });

  describe('with a back destination', () => {
    // The button prefers real browser history over the fixed `backTo`, so it
    // lands wherever the user actually came from.
    it('falls back to backTo when there is no app history behind this page', async () => {
      renderWithProviders(<AppHeader backTo="/rooms/room-1/documents" backLabel="Documenti" />);
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Documenti' }));

      expect(navigate).toHaveBeenCalledWith('/rooms/room-1/documents');
    });

    it('goes back through real browser history when there is some', async () => {
      // Set by React Router's BrowserHistory after at least one in-app push.
      window.history.pushState({ idx: 1 }, '', '/somewhere-else');
      renderWithProviders(<AppHeader backTo="/rooms/room-1/documents" backLabel="Documenti" />);
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Documenti' }));

      expect(navigate).toHaveBeenCalledWith(-1);
    });

    it('renders alongside the Glossary burger on a Room page', () => {
      renderWithProviders(
        <AppHeader roomId="room-1" backTo="/rooms/room-1/documents" backLabel="Documenti" />,
      );

      expect(screen.getByRole('button', { name: 'Apri indice dei Tag' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Documenti' })).toBeInTheDocument();
    });
  });

  describe('with a Room', () => {
    it('offers a burger that opens the Glossary Index', async () => {
      renderWithProviders(<AppHeader roomId="room-1" />);
      const user = userEvent.setup();

      expect(screen.queryByText('Indice dei Tag')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Apri indice dei Tag' }));

      expect(await screen.findByText('Indice dei Tag')).toBeInTheDocument();
    });

    it('closes the Glossary Index on a second click', async () => {
      renderWithProviders(<AppHeader roomId="room-1" />);
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Apri indice dei Tag' }));
      await screen.findByText('Indice dei Tag');
      await user.click(screen.getByRole('button', { name: 'Chiudi indice dei Tag' }));

      await waitFor(() => expect(screen.queryByText('Indice dei Tag')).not.toBeInTheDocument());
    });

    // The Drawer also closes itself (e.g. picking a Tag), not just via the
    // burger - AppHeader's own onClose has to handle that too.
    it('closes the Glossary Index when a Tag inside it is picked', async () => {
      fetchMock.mockImplementation((path: string) =>
        path.endsWith('/tags') ? Promise.resolve(oneTag) : Promise.resolve(rawAccount()),
      );
      renderWithProviders(<AppHeader roomId="room-1" />);
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Apri indice dei Tag' }));
      await user.click(await screen.findByText('#NPC'));

      await waitFor(() => expect(screen.queryByText('Indice dei Tag')).not.toBeInTheDocument());
    });
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

  // Friend requests received plus Room invitations from Friends.
  it('counts what waits for an answer on the Account page', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path === '/friends') {
        return Promise.resolve(
          rawFriends({ incoming: [rawFriend(), rawFriend({ friendship_id: 'friendship-2' })] }),
        );
      }
      if (path === '/invitations/mine') return Promise.resolve([rawDirectInvitation()]);
      return Promise.resolve(rawAccount());
    });

    renderWithProviders(<AccountButton />);

    const link = await screen.findByRole('link', { name: 'Il tuo account: 3 da vedere' });
    expect(within(link).getByText('3')).toBeInTheDocument();
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
