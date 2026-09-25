import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { unknownUserLabel } from '../lib/members';
import { renderWithProviders } from '../test/utils';
import { UserAvatar } from './UserAvatar';
import type { UserIdentity } from '../types/profile';

function identity(overrides: Partial<UserIdentity> = {}): UserIdentity {
  return {
    email: 'giocatore@example.com',
    displayName: 'Giocatore',
    pronouns: null,
    bio: null,
    avatarUrl: null,
    ...overrides,
  };
}

describe('UserAvatar', () => {
  it('uses the avatar image when the user has one', () => {
    renderWithProviders(<UserAvatar user={identity({ avatarUrl: 'http://a/v.webp' })} />);

    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://a/v.webp');
  });

  // The alt text is the only thing a screen reader gets here, so it has to
  // be the person's name rather than "avatar".
  it('labels the image with the chosen name', () => {
    renderWithProviders(<UserAvatar user={identity({ avatarUrl: 'http://a/v.webp' })} />);

    expect(screen.getByAltText('Giocatore')).toBeInTheDocument();
  });

  it('falls back to initials when there is no avatar', () => {
    renderWithProviders(<UserAvatar user={identity()} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('GI')).toBeInTheDocument();
  });

  it('names the user by email when they never chose a display name', () => {
    renderWithProviders(<UserAvatar user={identity({ displayName: null })} />);

    expect(screen.getByTitle('giocatore@example.com')).toBeInTheDocument();
  });

  // A member whose mirror row is missing: initials of the placeholder, never
  // a raw user id (architecture.md, Storage Model).
  it('falls back to the unknown-user label when the profile is missing', () => {
    renderWithProviders(<UserAvatar user={undefined} />);

    expect(screen.getByTitle(unknownUserLabel())).toBeInTheDocument();
  });
});
