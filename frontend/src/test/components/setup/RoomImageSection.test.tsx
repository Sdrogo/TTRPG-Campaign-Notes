import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/apiClient';
import { rawRoom } from '../../fixtures';
import { renderWithProviders } from '../../utils';
import { RoomImageSection } from '../../../components/setup/RoomImageSection';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  fetchMock.mockReset();
});

// Spec 26: the Room's image on the setup page, saved at once.
describe('RoomImageSection', () => {
  it('shows an empty frame and no Remove without an image', () => {
    renderWithProviders(<RoomImageSection roomId="room-1" imageUrl={null} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rimuovi' })).not.toBeInTheDocument();
  });

  it('uploads a picked file', async () => {
    fetchMock.mockResolvedValue(rawRoom({ image_url: 'http://signed/a.webp' }));
    const user = userEvent.setup();
    const { container } = renderWithProviders(<RoomImageSection roomId="room-1" imageUrl={null} />);
    const file = new File(['x'], 'cover.png', { type: 'image/png' });

    const input = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/rooms/room-1/image',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('imports an image from a URL', async () => {
    fetchMock.mockResolvedValue(rawRoom({ image_url: 'http://signed/a.webp' }));
    const user = userEvent.setup();
    renderWithProviders(<RoomImageSection roomId="room-1" imageUrl={null} />);

    await user.click(screen.getByRole('button', { name: 'Da URL' }));
    await user.type(screen.getByRole('textbox'), 'https://example.com/a.png');
    await user.click(screen.getByRole('button', { name: 'Usa immagine' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/image/from-url', {
        method: 'POST',
        json: { url: 'https://example.com/a.png' },
      }),
    );
  });

  it('shows the image and removes it', async () => {
    fetchMock.mockResolvedValue(rawRoom());
    const user = userEvent.setup();
    renderWithProviders(<RoomImageSection roomId="room-1" imageUrl="http://signed/a.webp" />);

    expect(screen.getByRole('img', { name: 'Immagine della Stanza' })).toHaveAttribute(
      'src',
      'http://signed/a.webp',
    );
    await user.click(screen.getByRole('button', { name: 'Rimuovi' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/image', { method: 'DELETE' }),
    );
  });
});
