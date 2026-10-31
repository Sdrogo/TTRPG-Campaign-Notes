import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LandingCard } from '../../../components/landing/LandingCard';
import { EditModeButton } from '../../../components/landing/EditModeButton';
import { renderWithProviders } from '../../utils';

describe('LandingCard', () => {
  it('is one link with its title, plain description and badge', () => {
    renderWithProviders(
      <LandingCard to="/rooms/r/sections/s" title="Tokyo" description="**Neon** e [[Aiko]]" badge="In corso" controls={<button>Menu</button>} />,
    );
    expect(screen.getByRole('link', { name: 'Tokyo' })).toHaveAttribute('href', '/rooms/r/sections/s');
    expect(screen.getByRole('heading', { level: 3, name: 'Tokyo' })).toBeInTheDocument();
    expect(screen.getByText(/Neon e/)).toBeInTheDocument();
    expect(screen.getByText('In corso')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows its image on the right half', () => {
    const { container } = renderWithProviders(<LandingCard to="/x" title="Kyoto" imageUrl="http://img/kyoto.webp" headingOrder={2} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Kyoto' })).toBeInTheDocument();
    expect(container.querySelector('[data-has-images]')).not.toBeNull();
    expect(container.querySelector('img')).toHaveAttribute('src', 'http://img/kyoto.webp');
  });
});

describe('EditModeButton', () => {
  it('toggles edit mode', async () => {
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(<EditModeButton editing={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Modifica' }));
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<EditModeButton editing onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Fine' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Fine' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});
