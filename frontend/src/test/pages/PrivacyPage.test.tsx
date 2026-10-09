import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setLanguage } from '../../i18n';
import { renderWithProviders } from '../utils';
import { PrivacyPage } from '../../pages/PrivacyPage';

describe('PrivacyPage', () => {
  it('shows every section of the notice, with lists as lists', () => {
    renderWithProviders(<PrivacyPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Informativa privacy' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Chi è il titolare',
      'Quali dati trattiamo',
      'Perché, e su quale base giuridica',
      'Chi li tratta, e dove',
      'Per quanto tempo li conserviamo',
      'I tuoi diritti',
      'Cookie e memoria locale',
    ]);
    expect(screen.getByText(/^Supabase: database/).closest('li')).not.toBeNull();
    expect(screen.getByText(/Ultimo aggiornamento: 9 ottobre 2026/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: "Torna all'app" })).toHaveAttribute('href', '/');
  });

  // The controller's name and address are the product owner's to set
  // (`PRIVACY_CONTROLLER`); until then the notice says so instead of
  // showing an empty sentence.
  it('marks the controller details still to be completed', () => {
    renderWithProviders(<PrivacyPage />);

    expect(
      screen.getByText(
        'Il titolare del trattamento è [da completare]. Per qualsiasi domanda sui tuoi dati, o per esercitare i tuoi diritti, scrivi a [da completare].',
      ),
    ).toBeInTheDocument();
  });

  it('reads in English', async () => {
    await setLanguage('en');
    renderWithProviders(<PrivacyPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Privacy notice' })).toBeInTheDocument();
    expect(screen.getByText(/Last updated: October 9, 2026/)).toBeInTheDocument();
  });
});
