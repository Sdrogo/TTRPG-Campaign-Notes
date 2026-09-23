import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { notifyError, notifySuccess } from '../lib/notify';
import { supabase } from '../lib/supabaseClient';
import { useSession } from '../hooks/useSession';
import { fakeSession, rawAccount } from '../test/fixtures';
import { renderWithProviders } from '../test/utils';
import { AccountPage } from './AccountPage';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock('../hooks/useSession', () => ({ useSession: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({
  supabase: { auth: { signOut: vi.fn() } },
}));

vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);
const sessionMock = vi.mocked(useSession);
const signOut = vi.mocked(supabase.auth.signOut);

type SessionState = ReturnType<typeof useSession>;

function render() {
  renderWithProviders(<AccountPage />, { route: '/account' });
  return { user: userEvent.setup() };
}

const nameField = () => screen.getByRole('textbox', { name: /Nome visualizzato/ });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(rawAccount());
  signOut.mockReset();
  vi.mocked(notifyError).mockClear();
  vi.mocked(notifySuccess).mockClear();
  sessionMock.mockReturnValue({ session: fakeSession(), loading: false } as SessionState);
});

describe('AccountPage', () => {
  it('waits on a loader while the session is resolving', () => {
    sessionMock.mockReturnValue({ session: null, loading: true } as SessionState);

    const { container } = renderWithProviders(<AccountPage />, { route: '/account' });

    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks an anonymous visitor to sign in', () => {
    sessionMock.mockReturnValue({ session: null, loading: false } as SessionState);
    render();

    expect(screen.getByText('Accedi per gestire il tuo account.')).toBeInTheDocument();
  });

  it('shows the profile once loaded', async () => {
    render();

    expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument();
    expect(nameField()).toHaveValue('Io');
  });

  // The email comes from the sign-in provider and cannot be edited here.
  it('shows the email read-only', async () => {
    render();

    const email = await screen.findByRole('textbox', { name: /Email/ });
    expect(email).toHaveValue('io@example.com');
    expect(email).toHaveAttribute('readonly');
    expect(email.parentElement?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('uses account-neutral wording for linked Google and GitHub identities', async () => {
    const session = {
      ...fakeSession(),
      user: {
        id: 'user-1',
        app_metadata: { provider: 'google' },
        identities: [{ provider: 'google' }, { provider: 'github' }],
      },
    };
    sessionMock.mockReturnValue({ session, loading: false } as SessionState);
    render();

    expect(
      await screen.findByText("L'email è quella dell'account con cui hai effettuato l'accesso."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Accedi con Google:/)).not.toBeInTheDocument();
  });

  it('uses the same account-neutral wording when provider metadata is missing', async () => {
    render();

    expect(
      await screen.findByText("L'email è quella dell'account con cui hai effettuato l'accesso."),
    ).toBeInTheDocument();
  });

  // X, for one, may not share an email address.
  it('says so when the account shared no email', async () => {
    fetchMock.mockResolvedValue({ ...rawAccount(), email: null });
    render();

    const email = await screen.findByRole('textbox', { name: /Email/ });
    expect(email).toHaveValue('');
    expect(email).toHaveAttribute('placeholder', 'Nessuna email condivisa dal tuo account');
  });

  it('offers a way back when the account cannot be loaded', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render();

    expect(await screen.findByText('Impossibile caricare il tuo account.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Torna alle mie Stanze' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});

describe('saving the profile', () => {
  it('sends the patch and confirms', async () => {
    const { user } = render();
    await screen.findByRole('heading', { name: 'Account' });

    await user.clear(nameField());
    await user.type(nameField(), 'Nuovo Nome');
    await user.click(screen.getByRole('button', { name: 'Salva profilo' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/account', {
        method: 'PATCH',
        json: { display_name: 'Nuovo Nome', pronouns: null, bio: null },
      }),
    );
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Profilo salvato.'));
  });

  // Saved, so there is nothing left to save until the next edit.
  it('settles back to clean after saving', async () => {
    const { user } = render();
    await screen.findByRole('heading', { name: 'Account' });

    await user.type(nameField(), '!');
    await user.click(screen.getByRole('button', { name: 'Salva profilo' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Salva profilo' })).toBeDisabled(),
    );
  });

  it('reports a rejected save', async () => {
    const { user } = render();
    await screen.findByRole('heading', { name: 'Account' });
    fetchMock.mockRejectedValue(new Error('Too long'));

    await user.type(nameField(), '!');
    await user.click(screen.getByRole('button', { name: 'Salva profilo' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });
});

describe('the avatar', () => {
  it('imports one from a URL', async () => {
    const { user } = render();
    await screen.findByRole('heading', { name: 'Account' });

    await user.click(screen.getByRole('button', { name: /Da URL/ }));
    await user.type(screen.getByLabelText("URL dell'immagine"), 'https://example.com/me.png');
    await user.click(screen.getByRole('button', { name: 'Usa immagine' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/account/avatar/from-url', {
        method: 'POST',
        json: { url: 'https://example.com/me.png' },
      }),
    );
  });

  it('removes one', async () => {
    fetchMock.mockResolvedValue(rawAccount({ avatar_url: 'http://a/me.webp' }));
    const { user } = render();
    await screen.findByRole('heading', { name: 'Account' });

    await user.click(screen.getByRole('button', { name: /Rimuovi/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/account/avatar', { method: 'DELETE' }),
    );
  });

  it('offers no removal when there is no avatar', async () => {
    render();
    await screen.findByRole('heading', { name: 'Account' });

    expect(screen.queryByRole('button', { name: /Rimuovi/ })).not.toBeInTheDocument();
  });

  it('reports a rejected upload', async () => {
    const { user } = render();
    await screen.findByRole('heading', { name: 'Account' });
    fetchMock.mockRejectedValue(new Error('Not an image'));

    await user.click(screen.getByRole('button', { name: /Da URL/ }));
    await user.type(screen.getByLabelText("URL dell'immagine"), 'https://example.com/me.png');
    await user.click(screen.getByRole('button', { name: 'Usa immagine' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });
});

describe('signing out', () => {
  it('signs out through Supabase', async () => {
    signOut.mockResolvedValue({ error: null } as Awaited<ReturnType<typeof supabase.auth.signOut>>);
    const { user } = render();
    await screen.findByRole('heading', { name: 'Account' });

    await user.click(screen.getByRole('button', { name: /Esci/ }));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
  });

  it('reports a failed sign-out', async () => {
    signOut.mockResolvedValue({ error: new Error('network') } as unknown as Awaited<
      ReturnType<typeof supabase.auth.signOut>
    >);
    const { user } = render();
    await screen.findByRole('heading', { name: 'Account' });

    await user.click(screen.getByRole('button', { name: /Esci/ }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });
});
