import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { supabase } from '../lib/supabaseClient';
import { useSession } from '../hooks/useSession';
import { fakeSession } from '../test/fixtures';
import { renderWithProviders } from '../test/utils';
import { HomePage } from './HomePage';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../hooks/useSession', () => ({ useSession: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({
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

  it('offers Google sign-in when nobody is signed in', () => {
    renderWithProviders(<HomePage />);

    expect(screen.getByRole('button', { name: /Accedi con Google/ })).toBeInTheDocument();
    expect(screen.getByText('Accedi per continuare.')).toBeInTheDocument();
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

  it('shows the Rooms list once signed in', async () => {
    signedIn();
    renderWithProviders(<HomePage />);

    expect(await screen.findByText('Le mie Stanze')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Accedi con Google/ })).not.toBeInTheDocument();
  });

  it('shows the app header once signed in', async () => {
    signedIn();
    renderWithProviders(<HomePage />);

    expect(await screen.findByRole('banner')).toBeInTheDocument();
  });
});
