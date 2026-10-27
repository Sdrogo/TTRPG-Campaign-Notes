import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PostItEditor } from '../../../components/sessionZero/PostItEditor';
import { renderWithProviders } from '../../utils';

describe('PostItEditor', () => {
  // Decision 12: the characters left show while typing, and turn to a warning near the end.
  it('counts the characters left and saves the trimmed text', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<PostItEditor submitLabel="Salva bozza" busy={false} onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect(screen.getByText('500 caratteri rimasti')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salva bozza' })).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: 'Testo del post-it' }), ' Ciao ');
    expect(screen.getByText('494 caratteri rimasti')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salva bozza' }));
    expect(onSubmit).toHaveBeenCalledWith('Ciao');
  });

  it('warns near the limit and waits while a write is on its way', () => {
    renderWithProviders(
      <PostItEditor initial={'x'.repeat(499)} submitLabel="Salva" busy onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText('1 carattere rimasto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salva' })).toBeDisabled();
  });
});
