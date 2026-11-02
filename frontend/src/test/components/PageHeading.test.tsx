import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeading } from '../../components/PageHeading';
import { EmptyState } from '../../components/EmptyState';
import { SectionLoader } from '../../components/PageState';
import { renderWithProviders } from '../utils';

// Spec 57c: the shared heading, empty state and in-page loader.
describe('PageHeading', () => {
  it('shows only the title when nothing else is given', () => {
    const { container } = renderWithProviders(<PageHeading title="Mappe" />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Mappe' })).toBeInTheDocument();
    expect(container.querySelector('.page-heading-kicker')).toBeNull();
    expect(container.querySelector('.page-heading-actions')).toBeNull();
  });

  it('shows the kicker, description, controls and actions', () => {
    renderWithProviders(
      <PageHeading
        kicker="La Cripta"
        title="Documenti"
        titleAfter={<button>Filtri</button>}
        description="Tutti i Documenti"
        actions={<button>Crea</button>}
        data-tour="room"
      />,
    );
    expect(screen.getByText('La Cripta')).toHaveClass('page-heading-kicker');
    expect(screen.getByRole('heading', { level: 1, name: 'Documenti' })).toBeInTheDocument();
    expect(screen.getByText('Tutti i Documenti')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filtri' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crea' }).closest('.page-heading-actions')).not.toBeNull();
    expect(document.querySelector('[data-tour="room"]')).toHaveClass('page-heading');
  });
});

describe('EmptyState', () => {
  it('shows its text, icon and optional action', () => {
    const { container, rerender } = renderWithProviders(<EmptyState icon={<svg data-testid="icon" />}>Nessuna mappa</EmptyState>);
    expect(screen.getByText('Nessuna mappa')).toBeInTheDocument();
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(container.querySelector('.empty-state')).not.toBeNull();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(
      <EmptyState icon={<svg />} action={<button>Crea</button>}>
        Nessuna mappa
      </EmptyState>,
    );
    expect(screen.getByRole('button', { name: 'Crea' })).toBeInTheDocument();
  });
});

describe('SectionLoader', () => {
  it('renders a loader', () => {
    const { container } = renderWithProviders(<SectionLoader />);
    expect(container.querySelector('.mantine-Loader-root')).not.toBeNull();
  });
});
