import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { savePendingFriendCode, savePendingInvite } from '../../lib/pendingInvite';
import { supabase } from '../../lib/supabaseClient';
import { useSession } from '../../hooks/useSession';
import { fakeSession } from '../fixtures';
import { renderWithProviders } from '../utils';
import { HomePage } from '../../pages/HomePage';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../hooks/useSession', () => ({ useSession: vi.fn() }));
vi.mock('../../lib/supabaseClient', () => ({
  supabase: { auth: { signInWithOAuth: vi.fn() } },
}));

const fetchMock = vi.mocked(apiFetch);
const sessionMock = vi.mocked(useSession);
const signInWithOAuth = vi.mocked(supabase.auth.signInWithOAuth);

type SessionState = ReturnType<typeof useSession>;

function signedIn() {
  sessionMock.mockReturnValue({ session: fakeSession(), loading: false } as SessionState);
}

beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue([]);
  signInWithOAuth.mockReset();
  sessionMock.mockReturnValue({ session: null, loading: false } as SessionState);
});

describe('HomePage', () => {
  it('waits on a loader while the session is resolving', () => {
    sessionMock.mockReturnValue({ session: null, loading: true } as SessionState);

    const { container } = renderWithProviders(<HomePage />);

    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Accedi con Google/ })).not.toBeInTheDocument();
  });

  it('offers every enabled provider when nobody is signed in', () => {
    renderWithProviders(<HomePage />);

    const buttons = screen.getAllByRole('button', { name: /^Accedi con / });
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Accedi con Google',
      'Accedi con Discord',
      'Accedi con GitHub',
    ]);
    buttons.forEach((button) => expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true'));
    expect(screen.getByText('Accedi per continuare.')).toBeInTheDocument();
    // The visitor's own top bar: no account avatar, a way to sign in.
    expect(screen.queryByRole('link', { name: 'Il tuo account' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Accedi' })).toHaveLength(2);
    // Spec 45_2: the Demo starts with a full page load, so a plain link.
    expect(screen.getByRole('link', { name: 'Prova la demo' })).toHaveAttribute('href', '/demo');
    // Spec 31_3: the privacy notice can be read before signing in.
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
  });

  // D-07: Google is the preferred login, so it's the one filled button.
  it('keeps Google as the primary action', () => {
    renderWithProviders(<HomePage />);

    const filled = screen
      .getAllByRole('button', { name: /^Accedi con / })
      .filter((button) => button.getAttribute('data-variant') === 'filled');
    expect(filled.map((button) => button.textContent)).toEqual(['Accedi con Google']);
  });

  // Supabase has one configured Site URL, but the app also runs on Vercel
  // previews and localhost, so the redirect has to be the current origin.
  it('signs in with Google, returning to the current origin', async () => {
    const user = userEvent.setup();
    renderWithProviders(<HomePage />);

    await user.click(screen.getByRole('button', { name: /Accedi con Google/ }));

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  });

  it.each([
    ['Discord', 'discord'],
    ['GitHub', 'github'],
  ])('signs in with %s, returning to the current origin', async (label, provider) => {
    const user = userEvent.setup();
    renderWithProviders(<HomePage />);

    await user.click(screen.getByRole('button', { name: `Accedi con ${label}` }));

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider,
      options: { redirectTo: window.location.origin },
    });
  });

  // Spec 45: the landing page is for everyone; a signed-in user gets the
  // header and the way to their Rooms instead of the sign-in buttons.
  it('shows the landing page once signed in, with the way to the Rooms', async () => {
    signedIn();
    renderWithProviders(<HomePage />);

    expect(await screen.findByRole('link', { name: 'Il tuo account' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Ex Libris' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apri le mie Stanze' })).toHaveAttribute('href', '/rooms');
    expect(screen.queryByRole('button', { name: /Accedi con Google/ })).not.toBeInTheDocument();
  });

  it('describes the app and its features', () => {
    renderWithProviders(<HomePage />);

    expect(screen.getByText('Il taccuino condiviso della tua campagna')).toBeInTheDocument();
    for (const title of ['Stanze e ruoli', 'Documenti e Note', 'Visibilità e Rivela', 'Commenti e discussioni', 'Mappe', 'Esportazione']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  // The return from OAuth lands on "/": a sign-in started here goes on to
  // the Rooms, while opening the site later shows the landing page.
  it('goes on to the Rooms right after a sign-in started here', async () => {
    const user = userEvent.setup();
    const landing = renderWithProviders(<HomePage />);
    await user.click(screen.getByRole('button', { name: 'Accedi con Google' }));
    landing.unmount();

    signedIn();
    renderWithProviders(
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/rooms" element={<p>rooms page</p>} />
      </Routes>,
    );

    expect(screen.getByText('rooms page')).toBeInTheDocument();
    expect(sessionStorage.getItem('pendingSignIn')).toBeNull();
  });

  // A sign-in cancelled at the provider comes back with no session: the
  // marker goes, so a later signed-in visit still shows the landing page.
  it('forgets a sign-in that came back without a session', () => {
    sessionStorage.setItem('pendingSignIn', '1');
    renderWithProviders(<HomePage />);

    expect(sessionStorage.getItem('pendingSignIn')).toBeNull();
  });

  it('keeps the marker while the session is still loading', () => {
    sessionStorage.setItem('pendingSignIn', '1');
    sessionMock.mockReturnValue({ session: null, loading: true } as SessionState);
    renderWithProviders(<HomePage />);

    expect(sessionStorage.getItem('pendingSignIn')).toBe('1');
  });

  it('stays on the landing page when no sign-in was started here', () => {
    signedIn();
    renderWithProviders(
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/rooms" element={<p>rooms page</p>} />
      </Routes>,
    );

    expect(screen.queryByText('rooms page')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apri le mie Stanze' })).toBeInTheDocument();
  });

  it('lets a pending invitation win over the Rooms after signing in', () => {
    sessionStorage.setItem('pendingSignIn', '1');
    signedIn();
    savePendingInvite('ABC123');
    renderWithProviders(
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/rooms" element={<p>rooms page</p>} />
        <Route path="/invite/:code" element={<p>invite page</p>} />
      </Routes>,
    );

    expect(screen.getByText('invite page')).toBeInTheDocument();
  });

  // OAuth returns to the site root, dropping the invite URL: the code saved by
  // the invite page must carry the user back to it.
  it('resumes a pending invitation after signing in', () => {
    signedIn();
    savePendingInvite('ABC123');
    renderWithProviders(
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/invite/:code" element={<p>invite page</p>} />
      </Routes>,
    );

    expect(screen.getByText('invite page')).toBeInTheDocument();
  });

  it('resumes a pending friend link after signing in', () => {
    signedIn();
    savePendingFriendCode('FRIEND1');
    renderWithProviders(
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/friends/add/:code" element={<p>friend link page</p>} />
      </Routes>,
    );

    expect(screen.getByText('friend link page')).toBeInTheDocument();
  });

  describe('the sign-in block', () => {
    const scrollIntoView = vi.fn();
    beforeEach(() => {
      scrollIntoView.mockReset();
      Element.prototype.scrollIntoView = scrollIntoView;
    });

    it('is where the Sign in buttons scroll to', async () => {
      const user = userEvent.setup();
      renderWithProviders(<HomePage />);

      for (const button of screen.getAllByRole('button', { name: 'Accedi' })) {
        await user.click(button);
      }

      expect(scrollIntoView).toHaveBeenCalledTimes(2);
      expect(scrollIntoView.mock.contexts[0]).toHaveAttribute('id', 'sign-in');
    });

    // "Go to sign in" links point to /#sign-in.
    it('is scrolled to when the address names it', () => {
      renderWithProviders(<HomePage />, { route: '/#sign-in' });

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });
  });
});

