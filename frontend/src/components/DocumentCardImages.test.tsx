import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { DocumentCardImages } from './DocumentCardImages';
import type { DocumentImage } from '../types/document';

const images: DocumentImage[] = [
  { id: 'image-1', url: 'http://a/1.webp', isFavorite: true },
  { id: 'image-2', url: 'http://a/2.webp', isFavorite: false },
];

describe('DocumentCardImages', () => {
  it('renders nothing without images', () => {
    renderWithProviders(<DocumentCardImages images={[]} documentName="Il Cancello" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  // One image needs no carousel, and its alt is just the Document name.
  it('renders a single image on its own', () => {
    renderWithProviders(
      <DocumentCardImages images={[images[0]]} documentName="Il Cancello" />,
    );

    expect(screen.getByAltText('Il Cancello')).toHaveAttribute('src', 'http://a/1.webp');
  });

  it('numbers the images when there are several', () => {
    renderWithProviders(<DocumentCardImages images={images} documentName="Il Cancello" />);

    expect(screen.getByAltText('Il Cancello (1)')).toBeInTheDocument();
    expect(screen.getByAltText('Il Cancello (2)')).toBeInTheDocument();
  });

  // Read-only on the card: managing images stays on the detail page.
  it('offers no delete or favorite controls', () => {
    renderWithProviders(<DocumentCardImages images={images} documentName="Il Cancello" />);

    expect(screen.queryByRole('button', { name: 'Elimina immagine' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Usa come immagine principale' }),
    ).not.toBeInTheDocument();
  });
});
