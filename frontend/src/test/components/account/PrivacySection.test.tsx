import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiDownload, apiFetch } from '../../../lib/apiClient';
import { notifyError, notifySuccess } from '../../../lib/notify';
import { saveBlob } from '../../../lib/roomExport';
import { supabase } from '../../../lib/supabaseClient';
import { renderWithProviders } from '../../utils';
import { PrivacySection } from '../../../components/account/PrivacySection';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn(), apiDownload: vi.fn() }));
vi.mock('../../../lib/roomExport', () => ({ saveBlob: vi.fn() }));
vi.mock('../../../lib/supabaseClient', () => ({
  supabase: { auth: { signOut: vi.fn() } },
}));
vi.mock('../../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(apiDownload).mockReset();
  vi.mocked(notifyError).mockClear();
  vi.mocked(notifySuccess).mockClear();
  vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null } as Awaited<
    ReturnType<typeof supabase.auth.signOut>
  >);
});

function render() {
  renderWithProviders(<PrivacySection />);
  return userEvent.setup();
}

async function openConfirmation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Elimina account' }));
  return screen.getByRole('button', { name: 'Elimina definitivamente' });
}

describe('PrivacySection', () => {
  it('links to the privacy notice', () => {
    render();
    expect(screen.getByRole('link', { name: 'Informativa privacy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });

  it('downloads the personal data', async () => {
    vi.mocked(apiDownload).mockResolvedValue(new Blob(['{}']));
    const user = render();

    await user.click(screen.getByRole('button', { name: 'Scarica i miei dati' }));

    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Dati scaricati'));
    expect(apiDownload).toHaveBeenCalledWith('/account/export');
    expect(saveBlob).toHaveBeenCalled();
  });

  it('reports a failed download', async () => {
    const error = new Error('offline');
    vi.mocked(apiDownload).mockRejectedValue(error);
    const user = render();

    await user.click(screen.getByRole('button', { name: 'Scarica i miei dati' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(vi.mocked(notifyError).mock.calls[0][0]).toBe(error);
  });

  // Spec 31_1: the deletion is permanent, so it waits for the word typed in
  // the app language.
  it('keeps the confirm button disabled until the word is typed', async () => {
    const user = render();
    const confirm = await openConfirmation(user);
    const field = screen.getByLabelText('Scrivi "ELIMINA" per confermare');

    await user.type(field, 'elimina');
    expect(confirm).toBeDisabled();
    await user.clear(field);
    await user.type(field, 'ELIMINA');
    expect(confirm).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deletes the account once confirmed', async () => {
    fetchMock.mockResolvedValue(undefined);
    const user = render();
    const confirm = await openConfirmation(user);
    await user.type(screen.getByLabelText('Scrivi "ELIMINA" per confermare'), 'ELIMINA');

    await user.click(confirm);

    await waitFor(() =>
      expect(notifySuccess).toHaveBeenCalledWith('Il tuo account è stato eliminato'),
    );
    expect(fetchMock).toHaveBeenCalledWith('/account', {
      method: 'DELETE',
      json: { confirmation: 'DELETE' },
    });
  });

  it('shows why the server refused, and cancelling clears the word', async () => {
    const error = new Error('Prima di eliminare l’account, nomina un altro Master in: Barovia');
    fetchMock.mockRejectedValue(error);
    const user = render();
    const confirm = await openConfirmation(user);
    await user.type(screen.getByLabelText('Scrivi "ELIMINA" per confermare'), 'ELIMINA');

    await user.click(confirm);
    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(vi.mocked(notifyError).mock.calls[0][0]).toBe(error);

    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    await openConfirmation(user);
    expect(screen.getByLabelText('Scrivi "ELIMINA" per confermare')).toHaveValue('');
  });
});
