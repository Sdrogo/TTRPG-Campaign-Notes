import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { ImageViewerModal } from './ImageViewerModal';
import type { DocumentImage } from '../types/document';

const images: DocumentImage[] = [
  { id: 'image-1', url: 'http://a/1.webp', isFavorite: true },
  { id: 'image-2', url: 'http://a/2.webp', isFavorite: false },
  { id: 'image-3', url: 'http://a/3.webp', isFavorite: false },
];

function open(index: number | null, overrides: Partial<Parameters<typeof ImageViewerModal>[0]> = {}) {
  const onIndexChange = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    <ImageViewerModal
      images={images}
      index={index}
      onIndexChange={onIndexChange}
      onClose={onClose}
      alt="Il Cancello"
      {...overrides}
    />,
  );
  return { onIndexChange, onClose, user: userEvent.setup() };
}

describe('ImageViewerModal', () => {
  it('shows nothing while closed', () => {
    open(null);

    expect(screen.queryByAltText('Il Cancello')).not.toBeInTheDocument();
  });

  it('shows the image at the given index', () => {
    open(1);

    expect(screen.getByAltText('Il Cancello')).toHaveAttribute('src', 'http://a/2.webp');
  });

  it('counts the position in the set', () => {
    open(1);

    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('moves to the next image', async () => {
    const { onIndexChange, user } = open(0);

    await user.click(screen.getByRole('button', { name: 'Immagine successiva' }));

    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it('moves to the previous image', async () => {
    const { onIndexChange, user } = open(1);

    await user.click(screen.getByRole('button', { name: 'Immagine precedente' }));

    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  it('wraps forward past the last image', async () => {
    const { onIndexChange, user } = open(2);

    await user.click(screen.getByRole('button', { name: 'Immagine successiva' }));

    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  // The modulo has to handle the negative case, or this lands on -1.
  it('wraps backward past the first image', async () => {
    const { onIndexChange, user } = open(0);

    await user.click(screen.getByRole('button', { name: 'Immagine precedente' }));

    expect(onIndexChange).toHaveBeenCalledWith(2);
  });

  it('offers no navigation for a single image', () => {
    renderWithProviders(
      <ImageViewerModal
        images={[images[0]]}
        index={0}
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
        alt="Il Cancello"
      />,
    );

    expect(screen.queryByRole('button', { name: 'Immagine successiva' })).not.toBeInTheDocument();
    expect(screen.queryByText('1 / 1')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const { onClose, user } = open(0);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });
});

describe('zoom controls', () => {
  it('starts fitted to the screen at 100%', () => {
    open(0);

    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('cannot zoom out below the fitted size', () => {
    open(0);

    expect(screen.getByRole('button', { name: 'Riduci' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Adatta allo schermo' })).toBeDisabled();
  });

  it('zooms in a step at a time', async () => {
    const { user } = open(0);

    await user.click(screen.getByRole('button', { name: 'Ingrandisci' }));

    expect(screen.getByText('150%')).toBeInTheDocument();
  });

  it('enables zooming out again once zoomed in', async () => {
    const { user } = open(0);
    await user.click(screen.getByRole('button', { name: 'Ingrandisci' }));

    await user.click(screen.getByRole('button', { name: 'Riduci' }));

    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('stops at the maximum zoom', async () => {
    const { user } = open(0);
    const zoomIn = screen.getByRole('button', { name: 'Ingrandisci' });

    // 1 -> 5 in 0.5 steps is 8 clicks; a ninth must not go past 500%.
    for (let i = 0; i < 9; i += 1) {
      await user.click(zoomIn);
    }

    expect(screen.getByText('500%')).toBeInTheDocument();
    expect(zoomIn).toBeDisabled();
  });

  it('snaps back to fitted', async () => {
    const { user } = open(0);
    await user.click(screen.getByRole('button', { name: 'Ingrandisci' }));
    await user.click(screen.getByRole('button', { name: 'Ingrandisci' }));

    await user.click(screen.getByRole('button', { name: 'Adatta allo schermo' }));

    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('toggles zoom on a double click', async () => {
    const { user } = open(0);

    await user.dblClick(screen.getByAltText('Il Cancello'));
    expect(screen.getByText('200%')).toBeInTheDocument();

    await user.dblClick(screen.getByAltText('Il Cancello'));
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
