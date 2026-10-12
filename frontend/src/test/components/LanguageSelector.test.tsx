import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n, { LANGUAGE_STORAGE_KEY, currentLanguage } from '../../i18n';
import { apiFetch } from '../../lib/apiClient';
import { notifyError } from '../../lib/notify';
import { rawAccount } from '../fixtures';
import { renderWithProviders } from '../utils';
import { AppHeader } from '../../components/AppHeader';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

beforeEach(() => {
  vi.mocked(notifyError).mockClear();
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockResolvedValue(rawAccount());
});

describe('LanguageSelector', () => {
  it('sits in the top bar just before the account avatar (spec 09)', () => {
    renderWithProviders(<AppHeader />);

    const flag = screen.getByRole('button', { name: 'Lingua: Italiano' });
    const avatar = screen.getByRole('link', { name: 'Il tuo account' });
    expect(flag.compareDocumentPosition(avatar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('lists every language by its own name and marks the current one', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppHeader />);

    await user.click(screen.getByRole('button', { name: 'Lingua: Italiano' }));

    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    // Every language by its own name; the ones nobody has read yet carry a "beta" label, in the UI language.
    expect(items.map((item) => item.textContent)).toEqual([
      'Italiano',
      'English',
      'Deutschbeta',
      'Españolbeta',
      'Françaisbeta',
      'Nederlandsbeta',
      'Polskibeta',
      'Portuguêsbeta',
      'Русскийbeta',
    ]);
    expect(within(menu).getByRole('menuitem', { name: 'Italiano' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(menu).getByRole('menuitem', { name: 'English' })).toHaveAttribute('lang', 'en');
  });

  it('switches the whole UI and remembers the pick', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppHeader />);

    await user.click(screen.getByRole('button', { name: 'Lingua: Italiano' }));
    await user.click(screen.getByRole('menuitem', { name: 'English' }));

    expect(currentLanguage()).toBe('en');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
    // Other components pick the new language up too, not just the selector.
    expect(await screen.findByRole('link', { name: 'Your account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Language: English' })).toBeInTheDocument();
  });

  it('says so when the language cannot be switched, and stays as it was', async () => {
    vi.spyOn(i18n, 'changeLanguage').mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    renderWithProviders(<AppHeader />);

    await user.click(screen.getByRole('button', { name: 'Lingua: Italiano' }));
    await user.click(screen.getByRole('menuitem', { name: 'English' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(vi.mocked(notifyError).mock.calls[0][0]).toEqual(
      new Error('Impossibile caricare la lingua. Riprova.'),
    );
    expect(currentLanguage()).toBe('it');
  });
});
