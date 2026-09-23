import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { DocumentCardImages } from './DocumentCardImages';
import type { DocumentImage } from '../types/document';

const images: DocumentImage[] = [
  { id: 'image-1', url: 'http://a/1.webp', isFavorite: true },
  { id: 'image-2', url: 'http://a/2.webp', isFavorite: false },
];

// jsdom never decodes images, so a load is simulated with the size a browser
// would have read from the file.
function loadImage(img: HTMLElement, naturalWidth: number, naturalHeight: number) {
  Object.defineProperty(img, 'naturalWidth', { value: naturalWidth });
  Object.defineProperty(img, 'naturalHeight', { value: naturalHeight });
  fireEvent.load(img);
}

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

  // Spec 07.1: the image keeps its own aspect ratio instead of being cropped
  // into a landscape frame.
  describe('orientation', () => {
    it('holds a placeholder until the image has loaded', () => {
      renderWithProviders(
        <DocumentCardImages images={[images[0]]} documentName="Il Cancello" />,
      );

      expect(screen.getByAltText('Il Cancello')).not.toHaveAttribute('data-orientation');
    });

    it('frames a wide image as landscape', () => {
      renderWithProviders(
        <DocumentCardImages images={[images[0]]} documentName="Il Cancello" />,
      );
      const img = screen.getByAltText('Il Cancello');

      loadImage(img, 1600, 900);

      expect(img).toHaveAttribute('data-orientation', 'landscape');
      expect(img).toHaveStyle({ width: '100%', objectFit: 'contain' });
    });

    it('frames a tall image as portrait', () => {
      renderWithProviders(
        <DocumentCardImages images={[images[0]]} documentName="Il Cancello" />,
      );
      const img = screen.getByAltText('Il Cancello');

      loadImage(img, 900, 1600);

      expect(img).toHaveAttribute('data-orientation', 'portrait');
      expect(img).toHaveStyle({ width: 'auto', objectFit: 'contain' });
    });

    // Each slide is framed on its own, so one carousel can mix both.
    it('frames each carousel image by its own shape', () => {
      renderWithProviders(<DocumentCardImages images={images} documentName="Il Cancello" />);
      const first = screen.getByAltText('Il Cancello (1)');
      const second = screen.getByAltText('Il Cancello (2)');

      loadImage(first, 900, 1600);
      loadImage(second, 1600, 900);

      expect(first).toHaveAttribute('data-orientation', 'portrait');
      expect(second).toHaveAttribute('data-orientation', 'landscape');
    });
  });
});
