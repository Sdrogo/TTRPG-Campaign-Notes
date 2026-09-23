import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { ImageAttachButtons } from './ImageAttachButtons';

function render(remaining = 4) {
  const onAddFiles = vi.fn();
  const onAddUrl = vi.fn();
  renderWithProviders(
    <ImageAttachButtons remaining={remaining} onAddFiles={onAddFiles} onAddUrl={onAddUrl} />,
  );
  return { onAddFiles, onAddUrl, user: userEvent.setup() };
}

describe('ImageAttachButtons', () => {
  it('offers both ways to attach', () => {
    render();

    expect(screen.getByRole('button', { name: 'Aggiungi immagini' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aggiungi immagine da URL' })).toBeInTheDocument();
  });

  it('adds an image by URL', async () => {
    const { onAddUrl, user } = render();

    await user.click(screen.getByRole('button', { name: 'Aggiungi immagine da URL' }));
    await user.type(screen.getByLabelText("URL dell'immagine"), 'https://example.com/map.png');
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));

    expect(onAddUrl).toHaveBeenCalledWith('https://example.com/map.png');
  });

  it('disables the URL button at the limit', () => {
    render(0);

    expect(screen.getByRole('button', { name: 'Aggiungi immagine da URL' })).toBeDisabled();
  });

  it('enables it again while slots remain', () => {
    render(1);

    expect(screen.getByRole('button', { name: 'Aggiungi immagine da URL' })).toBeEnabled();
  });

  it('accepts only the formats the backend takes', () => {
    const { container } = renderWithProviders(
      <ImageAttachButtons remaining={4} onAddFiles={vi.fn()} onAddUrl={vi.fn()} />,
    );

    expect(container.querySelector('input[type="file"]')).toHaveAttribute(
      'accept',
      'image/png,image/jpeg,image/webp,image/gif',
    );
  });
});
