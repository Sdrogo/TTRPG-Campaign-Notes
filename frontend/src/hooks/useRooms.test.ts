import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { rawMyRoom, rawRoom } from '../test/fixtures';
import { renderHookWithProviders } from '../test/utils';
import {
  useAcceptInvitation,
  useCreateInvitation,
  useCreateRoom,
  useMyRooms,
  useRoom,
  useUpdateRoomSettings,
} from './useRooms';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));

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
    const room = await result.current.mutateAsync(false);

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1', {
      method: 'PATCH',
      json: { players_can_create_documents: false },
    });
    expect(room.playersCanCreateDocuments).toBe(false);
  });

  // The flag shows on the Room detail and drives "can I create a Document?"
  // on the list, so both caches have to go.
  it('invalidates both the single Room and the list', async () => {
    fetchMock.mockResolvedValue(rawRoom());
    const { result, queryClient } = renderHookWithProviders(() =>
      useUpdateRoomSettings('room-1'),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync(true);

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms', 'room-1'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms'] });
    });
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
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms'] }));
  });

  it('propagates a rejected invitation', async () => {
    fetchMock.mockRejectedValue(new Error('Invitation expired'));

    const { result } = renderHookWithProviders(() => useAcceptInvitation());

    await expect(result.current.mutateAsync('EXPIRED')).rejects.toThrow('Invitation expired');
  });
});
