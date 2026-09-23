import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { FullPageLoader, FullPageMessage, SignInRequired } from './PageState';

describe('FullPageLoader', () => {
  it('renders a loader', () => {
    const { container } = renderWithProviders(<FullPageLoader />);

    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
  });
});

describe('FullPageMessage', () => {
  it('shows the message', () => {
    renderWithProviders(<FullPageMessage>Stanza non trovata</FullPageMessage>);

    expect(screen.getByText('Stanza non trovata')).toBeInTheDocument();
  });

  it('renders the action as a link to the given route', () => {
    renderWithProviders(
      <FullPageMessage actionLabel="Torna alle stanze" actionTo="/rooms">
        Documento non trovato
      </FullPageMessage>,
    );

    expect(screen.getByRole('link', { name: 'Torna alle stanze' })).toHaveAttribute(
      'href',
      '/rooms',
    );
  });

  it('renders no action when there is nowhere to go', () => {
    renderWithProviders(<FullPageMessage>Solo un messaggio</FullPageMessage>);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  // Both halves are needed for a usable button; a label with no destination
  // would render a dead control.
  it('renders no action when only a label was given', () => {
    renderWithProviders(<FullPageMessage actionLabel="Vai">Messaggio</FullPageMessage>);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('SignInRequired', () => {
  it('points at the login route', () => {
    renderWithProviders(<SignInRequired>Accedi per vedere questa stanza</SignInRequired>);

    expect(screen.getByText('Accedi per vedere questa stanza')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vai al login' })).toHaveAttribute('href', '/');
  });
});
