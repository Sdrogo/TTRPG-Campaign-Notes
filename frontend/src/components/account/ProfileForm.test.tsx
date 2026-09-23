import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MAX_BIO_LENGTH } from '../../lib/profile';
import { renderWithProviders } from '../../test/utils';
import { ProfileForm } from './ProfileForm';
import type { AccountProfile } from '../../types/profile';

function profile(overrides: Partial<AccountProfile> = {}): AccountProfile {
  return {
    userId: 'user-1',
    email: 'io@example.com',
    displayName: 'Io',
    pronouns: 'lei',
    bio: 'Due righe.',
    avatarUrl: null,
    ...overrides,
  };
}

function render(overrides: Partial<AccountProfile> = {}, saving = false) {
  const onSubmit = vi.fn();
  renderWithProviders(
    <ProfileForm profile={profile(overrides)} onSubmit={onSubmit} saving={saving} />,
  );
  return { onSubmit, user: userEvent.setup() };
}

const nameField = () => screen.getByRole('textbox', { name: /Nome visualizzato/ });
const bioField = () => screen.getByRole('textbox', { name: /Descrizione/ });
const saveButton = () => screen.getByRole('button', { name: 'Salva profilo' });

describe('ProfileForm', () => {
  it('starts from the stored profile', () => {
    render();

    expect(nameField()).toHaveValue('Io');
    expect(screen.getByRole('textbox', { name: 'Pronomi' })).toHaveValue('lei');
    expect(bioField()).toHaveValue('Due righe.');
  });

  // Unset fields are null on the wire but empty strings in the form.
  it('shows an unset field as empty, not as "null"', () => {
    render({ displayName: null, pronouns: null, bio: null });

    expect(nameField()).toHaveValue('');
    expect(bioField()).toHaveValue('');
  });

  // The email is what others see until a name is chosen, so it's the hint.
  it('hints the email as the name that would be shown instead', () => {
    render({ displayName: null });

    expect(nameField()).toHaveAttribute('placeholder', 'io@example.com');
  });

  it('falls back to a generic hint when there is no email either', () => {
    render({ displayName: null, email: null });

    expect(nameField()).toHaveAttribute('placeholder', 'Il tuo nome');
  });

  it('cannot save before anything changes', () => {
    render();

    expect(saveButton()).toBeDisabled();
  });

  it('enables saving once a field changes', async () => {
    const { user } = render();

    await user.type(nameField(), '!');

    expect(saveButton()).toBeEnabled();
  });

  it('submits the edited values', async () => {
    const { onSubmit, user } = render();

    await user.clear(nameField());
    await user.type(nameField(), 'Nuovo Nome');
    await user.click(saveButton());

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Nuovo Nome' }),
      expect.any(Function),
    );
  });

  it('reverts the edits when asked', async () => {
    const { user } = render();
    await user.type(nameField(), ' modificato');

    await user.click(screen.getByRole('button', { name: 'Annulla modifiche' }));

    expect(nameField()).toHaveValue('Io');
    expect(saveButton()).toBeDisabled();
  });

  it('shows the save in progress', () => {
    render({}, true);

    expect(saveButton()).toHaveAttribute('data-loading', 'true');
  });
});

describe('limits', () => {
  // Mirrors app/domain/profiles.py; the backend re-checks.
  it('rejects a name over the limit', async () => {
    const { onSubmit, user } = render({ displayName: null });

    await user.type(nameField(), 'a'.repeat(61));
    await user.click(saveButton());

    expect(await screen.findByText('Massimo 60 caratteri')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('accepts a name exactly at the limit', async () => {
    const { onSubmit, user } = render({ displayName: null });

    await user.type(nameField(), 'a'.repeat(60));
    await user.click(saveButton());

    expect(onSubmit).toHaveBeenCalled();
  });

  it('counts the description against its limit', async () => {
    const { user } = render({ bio: null });

    await user.type(bioField(), 'Dodici.');

    expect(screen.getByText(`7/${MAX_BIO_LENGTH}`)).toBeInTheDocument();
  });

  // Counted after trimming, like the backend does.
  it('does not count surrounding whitespace', async () => {
    const { user } = render({ bio: null });

    await user.type(bioField(), '  ciao  ');

    expect(screen.getByText(`4/${MAX_BIO_LENGTH}`)).toBeInTheDocument();
  });
});
