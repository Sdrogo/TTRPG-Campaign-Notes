import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { DocumentImageGallery } from './DocumentImageGallery';
import type { DocumentImage } from '../types/document';

const images: DocumentImage[] = [
  { id: 'image-1', url: 'http://a/1.webp', isFavorite: true },
  { id: 'image-2', url: 'http://a/2.webp', isFavorite: false },
];

type Props = Parameters<typeof DocumentImageGallery>[0];

function render(overrides: Partial<Props> = {}) {
  const onDelete = vi.fn();
  const onSetFavorite = vi.fn();
  renderWithProviders(
    <DocumentImageGallery
      images={images}
      documentName="Il Cancello"
      canDelete
      onDelete={onDelete}
      deletingImageId={null}
      onSetFavorite={onSetFavorite}
      {...overrides}
    />,
  );
  return { onDelete, onSetFavorite, user: userEvent.setup() };
}

describe('DocumentImageGallery', () => {
  it('renders nothing when the Document has no images', () => {
    render({ images: [] });

    expect(screen.queryByRole('button', { name: 'Apri immagine' })).not.toBeInTheDocument();
  });

  it('renders a single image without a carousel', () => {
    render({ images: [images[0]] });

    expect(screen.getByAltText('Il Cancello (1)')).toBeInTheDocument();
    expect(screen.queryByAltText('Il Cancello (2)')).not.toBeInTheDocument();
  });

  it('numbers each image in its alt text', () => {
    render();

    expect(screen.getByAltText('Il Cancello (1)')).toBeInTheDocument();
    expect(screen.getByAltText('Il Cancello (2)')).toBeInTheDocument();
  });

  it('opens the fullscreen viewer on the clicked image', async () => {
    const { user } = render({ images: [images[0]] });

    await user.click(screen.getByRole('button', { name: 'Apri immagine' }));

    expect(screen.getByAltText('Il Cancello')).toHaveAttribute('src', 'http://a/1.webp');
  });
});

describe('deleting an image', () => {
  it('hides the delete control from a viewer who may not delete', () => {
    render({ canDelete: false });

    expect(screen.queryByRole('button', { name: 'Elimina immagine' })).not.toBeInTheDocument();
  });

  // Deletion is not undoable, so it asks first - unlike the favorite heart.
  it('asks for confirmation before deleting', async () => {
    const { onDelete, user } = render({ images: [images[0]] });

    await user.click(screen.getByRole('button', { name: 'Elimina immagine' }));

    expect(screen.getByText('Eliminare questa immagine?')).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('deletes the image once confirmed', async () => {
    const { onDelete, user } = render({ images: [images[0]] });
    await user.click(screen.getByRole('button', { name: 'Elimina immagine' }));

    await user.click(screen.getByRole('button', { name: 'Elimina' }));

    expect(onDelete).toHaveBeenCalledWith('image-1');
  });

  it('deletes nothing when the confirmation is dismissed', async () => {
    const { onDelete, user } = render({ images: [images[0]] });
    await user.click(screen.getByRole('button', { name: 'Elimina immagine' }));

    await user.click(screen.getByRole('button', { name: 'Annulla' }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText('Eliminare questa immagine?')).not.toBeInTheDocument();
  });
});

describe('the favorite image', () => {
  // Spec 07: exactly one image leads the Document, and it's the one the card
  // shows. The heart is the only way to move it.
  it('marks the current favorite as pressed and not clickable again', () => {
    render({ images: [images[0]] });

    const heart = screen.getByRole('button', { name: 'Usa come immagine principale' });
    expect(heart).toHaveAttribute('aria-pressed', 'true');
    expect(heart).toBeDisabled();
  });

  it('offers the heart on a non-favorite image', () => {
    render({ images: [images[1]] });

    const heart = screen.getByRole('button', { name: 'Usa come immagine principale' });
    expect(heart).toHaveAttribute('aria-pressed', 'false');
    expect(heart).toBeEnabled();
  });

  it('reports which image should become the favorite', async () => {
    const { onSetFavorite, user } = render({ images: [images[1]] });

    await user.click(screen.getByRole('button', { name: 'Usa come immagine principale' }));

    expect(onSetFavorite).toHaveBeenCalledWith('image-2');
  });

  // A viewer who isn't an Owner can still see the gallery but must not be
  // offered an action the backend would reject.
  it('hides the heart when the viewer may not move the favorite', () => {
    render({ images: [images[1]], onSetFavorite: undefined });

    expect(
      screen.queryByRole('button', { name: 'Usa come immagine principale' }),
    ).not.toBeInTheDocument();
  });
});
