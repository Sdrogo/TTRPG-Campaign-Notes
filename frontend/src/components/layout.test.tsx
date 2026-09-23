// The thin layout wrappers, covered together: each is a handful of lines
// with one thing worth asserting, and a file apiece would be noise.
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { rawAccount } from '../test/fixtures';
import { renderWithProviders } from '../test/utils';
import { AppHeader } from './AppHeader';
import { PageCard } from './PageCard';
import { PageLayout } from './PageLayout';
import { AccountSection } from './account/AccountSection';
import { AccountButton } from './account/AccountButton';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(rawAccount());
});

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
  it('renders the back link and the content', () => {
    renderWithProviders(
      <PageLayout backTo="/rooms/room-1/documents" backLabel="Documenti">
        <p>Contenuto</p>
      </PageLayout>,
    );

    expect(screen.getByRole('link', { name: 'Documenti' })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents',
    );
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
