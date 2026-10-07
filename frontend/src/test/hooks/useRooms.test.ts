import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { rawMyRoom, rawRoom } from '../fixtures';
import { renderHookWithProviders } from '../utils';
import {
  useAcceptInvitation,
  useCreateInvitation,
  useCreateRoom,
  useDeleteRoom,
  useImportRoomImage,
  useMyRooms,
  useRemoveRoomImage,
  useRoom,
  useUpdateRoomSettings,
  useUploadNewRoomImage,
  useUploadRoomImage,
} from '../../hooks/useRooms';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  fetchMock.mockReset();
});

describe('useMyRooms', () => {
  it('maps the wire shape onto the Room model', async () => {
    fetchMock.mockResolvedValue([rawMyRoom()]);

    const { result } = renderHookWithProviders(() => useMyRooms(true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/rooms');
    expect(result.current.data).toEqual([
      {
        room: {
          id: 'room-1',
          name: 'La Cripta',
          gameSystem: 'D&D 5e',
          status: 'active',
          playersCanCreateDocuments: true,
          defaultVisibility: 'room',
          imageUrl: null,
        },
        role: 'master',
        isAdmin: true,
      },
    ]);
  });

  // The session resolves after the first render; firing the request before
  // there's a token would just get a 401 back.
  it('does not fetch while disabled', () => {
    renderHookWithProviders(() => useMyRooms(false));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a failure instead of swallowing it', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    const { result } = renderHookWithProviders(() => useMyRooms(true));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('offline');
  });
});

describe('useRoom', () => {
  it('reads one Room and maps it', async () => {
    fetchMock.mockResolvedValue(rawRoom({ game_system: null }));

    const { result } = renderHookWithProviders(() => useRoom('room-1', true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1');
    expect(result.current.data?.gameSystem).toBeNull();
  });
});

describe('useCreateRoom', () => {
  it('posts the room and converts the game system to snake_case', async () => {
    fetchMock.mockResolvedValue(rawRoom());

    const { result } = renderHookWithProviders(() => useCreateRoom());
    await result.current.mutateAsync({ name: 'La Cripta', gameSystem: 'D&D 5e' });

    expect(fetchMock).toHaveBeenCalledWith('/rooms', {
      method: 'POST',
      json: { name: 'La Cripta', game_system: 'D&D 5e' },
    });
  });

  // An empty string from the form field means "not set", not a system named "".
  it('sends null for an omitted or blank game system', async () => {
    fetchMock.mockResolvedValue(rawRoom());

    const { result } = renderHookWithProviders(() => useCreateRoom());
    await result.current.mutateAsync({ name: 'Senza sistema', gameSystem: '' });

    expect(fetchMock).toHaveBeenCalledWith('/rooms', {
      method: 'POST',
      json: { name: 'Senza sistema', game_system: null },
    });
  });

  it('invalidates the rooms list so the new Room shows up', async () => {
    fetchMock.mockResolvedValue(rawRoom());
    const { result, queryClient } = renderHookWithProviders(() => useCreateRoom());
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync({ name: 'La Cripta' });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms'] }),
    );
  });
});

describe('useUpdateRoomSettings', () => {
  it('patches the Room with the snake_case flag', async () => {
    fetchMock.mockResolvedValue(rawRoom({ players_can_create_documents: false }));

    const { result } = renderHookWithProviders(() => useUpdateRoomSettings('room-1'));
    const room = await result.current.mutateAsync({ playersCanCreateDocuments: false });

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1', {
      method: 'PATCH',
      json: { players_can_create_documents: false, default_visibility: undefined },
    });
    expect(room.playersCanCreateDocuments).toBe(false);
  });

  // VR-05: the Administrators' starting level for new content.
  it('patches the default visibility alone', async () => {
    fetchMock.mockResolvedValue(rawRoom({ default_visibility: 'master' }));

    const { result } = renderHookWithProviders(() => useUpdateRoomSettings('room-1'));
    const room = await result.current.mutateAsync({ defaultVisibility: 'master' });

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1', {
      method: 'PATCH',
      json: { players_can_create_documents: undefined, default_visibility: 'master' },
    });
    expect(room.defaultVisibility).toBe('master');
  });

  // The flag shows on the Room detail and drives "can I create a Document?"
  // on the list, so both caches have to go.
  it('invalidates both the single Room and the list', async () => {
    fetchMock.mockResolvedValue(rawRoom());
    const { result, queryClient } = renderHookWithProviders(() =>
      useUpdateRoomSettings('room-1'),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync({ playersCanCreateDocuments: true });

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms', 'room-1'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms'] });
    });
  });
});

// Spec 26: the Room's image, the PDF's default cover.
describe('Room image', () => {
  const withImage = rawRoom({ image_url: 'http://signed/rooms/room-1/a.webp' });

  it('uploads a file and stores the returned Room', async () => {
    fetchMock.mockResolvedValue(withImage);
    const file = new File(['x'], 'cover.png', { type: 'image/png' });

    const { result, queryClient } = renderHookWithProviders(() => useUploadRoomImage('room-1'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const room = await result.current.mutateAsync(file);

    const [path, options] = fetchMock.mock.calls[0] as [
      string,
      { method: string; formData: FormData },
    ];
    expect(path).toBe('/rooms/room-1/image');
    expect(options.method).toBe('POST');
    expect(options.formData.get('file')).toBe(file);
    expect(room.imageUrl).toBe('http://signed/rooms/room-1/a.webp');
    expect(queryClient.getQueryData(['rooms', 'room-1'])).toEqual(room);
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms'], exact: true }),
    );
  });

  it('uploads the image of a Room just created', async () => {
    fetchMock.mockResolvedValue(withImage);
    const file = new File(['x'], 'cover.png', { type: 'image/png' });

    const { result, queryClient } = renderHookWithProviders(() => useUploadNewRoomImage());
    await result.current.mutateAsync({ roomId: 'room-1', file });

    expect(fetchMock.mock.calls[0][0]).toBe('/rooms/room-1/image');
    expect(queryClient.getQueryData<{ imageUrl: string }>(['rooms', 'room-1'])?.imageUrl).toBe(
      'http://signed/rooms/room-1/a.webp',
    );
  });

  it('imports from a URL', async () => {
    fetchMock.mockResolvedValue(withImage);

    const { result } = renderHookWithProviders(() => useImportRoomImage('room-1'));
    await result.current.mutateAsync('https://example.com/a.png');

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/image/from-url', {
      method: 'POST',
      json: { url: 'https://example.com/a.png' },
    });
  });

  it('removes it', async () => {
    fetchMock.mockResolvedValue(rawRoom());

    const { result } = renderHookWithProviders(() => useRemoveRoomImage('room-1'));
    const room = await result.current.mutateAsync();

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/image', { method: 'DELETE' });
    expect(room.imageUrl).toBeNull();
  });
});

describe('useCreateInvitation', () => {
  it('posts the role and maps the expiry field', async () => {
    fetchMock.mockResolvedValue({ code: 'ABC123', role: 'player', expires_at: null });

    const { result } = renderHookWithProviders(() => useCreateInvitation('room-1'));
    const invitation = await result.current.mutateAsync('player');

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/invitations', {
      method: 'POST',
      json: { role: 'player' },
    });
    expect(invitation).toEqual({ code: 'ABC123', role: 'player', expiresAt: null });
  });
});

describe('useAcceptInvitation', () => {
  it('posts to the accept endpoint and refreshes the rooms list', async () => {
    fetchMock.mockResolvedValue(rawRoom());
    const { result, queryClient } = renderHookWithProviders(() => useAcceptInvitation());
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const room = await result.current.mutateAsync('ABC123');

    expect(fetchMock).toHaveBeenCalledWith('/invitations/ABC123/accept', { method: 'POST' });
    expect(room.id).toBe('room-1');
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms'] }),
    );
  });

  // The accepted invitation leaves the user's list, and sharing a Room now
  // shows a Friend's email.
  it('refreshes the invitations waiting for the user and their Friends', async () => {
    fetchMock.mockResolvedValue(rawRoom());
    const { result, queryClient } = renderHookWithProviders(() => useAcceptInvitation());
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync('ABC123');

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['invitations', 'mine'] }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['friends'] });
  });

  it('propagates a rejected invitation', async () => {
    fetchMock.mockRejectedValue(new Error('Invitation expired'));

    const { result } = renderHookWithProviders(() => useAcceptInvitation());

    await expect(result.current.mutateAsync('EXPIRED')).rejects.toThrow('Invitation expired');
  });
});

describe('useDeleteRoom', () => {
  it('deletes the Room, drops its cached queries and refreshes the rooms list', async () => {
    fetchMock.mockResolvedValue(undefined);
    const { result, queryClient } = renderHookWithProviders(() => useDeleteRoom('room-1'));
    const remove = vi.spyOn(queryClient, 'removeQueries');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync();

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1', { method: 'DELETE' });
    // Removed, not refetched: every one of them would only 403.
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ queryKey: ['rooms', 'room-1'] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms'] });
  });

  it('propagates a rejection from the backend', async () => {
    fetchMock.mockRejectedValue(new Error('Only an Administrator can delete the Room'));

    const { result } = renderHookWithProviders(() => useDeleteRoom('room-1'));

    await expect(result.current.mutateAsync()).rejects.toThrow(
      'Only an Administrator can delete the Room',
    );
  });
});
