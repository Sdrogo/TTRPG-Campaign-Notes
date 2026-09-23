import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { ImageThumbnailGrid, type Thumbnail } from './ImageThumbnailGrid';

const images: Thumbnail[] = [
  { id: 'image-1', url: 'http://a/1.webp', label: 'mappa.png' },
  { id: 'image-2', url: 'http://a/2.webp', label: 'ritratto.png' },
];

describe('ImageThumbnailGrid', () => {
  it('renders one thumbnail per image, labelled by file name', () => {
    renderWithProviders(<ImageThumbnailGrid images={images} />);

    expect(screen.getByAltText('mappa.png')).toHaveAttribute('src', 'http://a/1.webp');
    expect(screen.getByAltText('ritratto.png')).toBeInTheDocument();
  });

  it('renders nothing when there are no images', () => {
    renderWithProviders(<ImageThumbnailGrid images={[]} />);

    expect(screen.queryByTestId('image-thumbnails')).not.toBeInTheDocument();
  });

  it('is read-only unless handlers are given', () => {
    renderWithProviders(<ImageThumbnailGrid images={images} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // The index, not the id: the viewer opens at that position in the gallery.
  it('reports the index of the thumbnail that was opened', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ImageThumbnailGrid images={images} onOpen={onOpen} />);

    await user.click(screen.getByRole('button', { name: 'Apri ritratto.png' }));

    expect(onOpen).toHaveBeenCalledWith(1);
  });

  // The id, not the index: a removal has to survive the list shifting.
  it('reports the id of the thumbnail that was removed', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ImageThumbnailGrid images={images} onRemove={onRemove} />);

    await user.click(screen.getByRole('button', { name: 'Rimuovi mappa.png' }));

    expect(onRemove).toHaveBeenCalledWith('image-1');
  });

  it('offers both actions per image when both handlers are given', () => {
    renderWithProviders(
      <ImageThumbnailGrid images={images} onOpen={vi.fn()} onRemove={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: 'Apri mappa.png' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rimuovi mappa.png' })).toBeInTheDocument();
  });
});
