import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { AvatarEditor, type AvatarAction } from './AvatarEditor';
import type { UserIdentity } from '../../types/profile';

function user(overrides: Partial<UserIdentity> = {}): UserIdentity {
  return {
    email: 'io@example.com',
    displayName: 'Io',
    pronouns: null,
    bio: null,
    avatarUrl: 'http://a/me.webp',
    ...overrides,
  };
}

function render(overrides: Partial<UserIdentity> = {}, pending: AvatarAction | null = null) {
  const onUpload = vi.fn();
  const onImportUrl = vi.fn();
  const onRemove = vi.fn();
  renderWithProviders(
    <AvatarEditor
      user={user(overrides)}
      onUpload={onUpload}
      onImportUrl={onImportUrl}
      onRemove={onRemove}
      pending={pending}
    />,
  );
  return { onUpload, onImportUrl, onRemove, user: userEvent.setup() };
}

describe('AvatarEditor', () => {
  it('shows the current avatar', () => {
    render();

    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://a/me.webp');
  });

  it('names the accepted formats and the cropping', () => {
    render();

    expect(screen.getByText(/PNG, JPEG, WebP o GIF/)).toBeInTheDocument();
    expect(screen.getByText(/ritagliata al centro/)).toBeInTheDocument();
  });

  // Nothing to remove when there's no avatar.
  it('offers removal only when there is an avatar', () => {
    render({ avatarUrl: null });

    expect(screen.queryByRole('button', { name: /Rimuovi/ })).not.toBeInTheDocument();
  });

  it('removes the avatar', async () => {
    const { onRemove, user: u } = render();

    await u.click(screen.getByRole('button', { name: /Rimuovi/ }));

    expect(onRemove).toHaveBeenCalled();
  });

  it('imports an avatar from a URL', async () => {
    const { onImportUrl, user: u } = render();

    await u.click(screen.getByRole('button', { name: /Da URL/ }));
    await u.type(screen.getByLabelText("URL dell'immagine"), 'https://example.com/me.png');
    await u.click(screen.getByRole('button', { name: 'Usa immagine' }));

    expect(onImportUrl).toHaveBeenCalledWith('https://example.com/me.png');
  });

  it('uploads a picked file', async () => {
    const { onUpload, user: u } = render();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await u.upload(input, new File(['bytes'], 'me.png', { type: 'image/png' }));

    expect(onUpload).toHaveBeenCalledWith(expect.objectContaining({ name: 'me.png' }));
  });

  // Each action takes effect immediately, so a second one mid-flight could
  // race the first.
  it('disables the other actions while one is in flight', () => {
    render({}, 'upload');

    expect(screen.getByRole('button', { name: /Carica foto/ })).toHaveAttribute(
      'data-loading',
      'true',
    );
    expect(screen.getByRole('button', { name: /Da URL/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Rimuovi/ })).toBeDisabled();
  });

  it('spins only the action that is running', () => {
    render({}, 'remove');

    expect(screen.getByRole('button', { name: /Rimuovi/ })).toHaveAttribute(
      'data-loading',
      'true',
    );
    expect(screen.getByRole('button', { name: /Da URL/ })).not.toHaveAttribute('data-loading');
  });
});
