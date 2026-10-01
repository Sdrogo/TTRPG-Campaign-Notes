import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { rawCharacter } from '../fixtures';
import { renderHookWithProviders } from '../utils';
import { useMyCharacters } from '../../hooks/useCharacters';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  fetchMock.mockReset();
});

describe('useMyCharacters', () => {
  it('loads the Characters the caller may write as', async () => {
    fetchMock.mockResolvedValue([rawCharacter()]);

    const { result } = renderHookWithProviders(() => useMyCharacters('room-1', true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/characters/mine');
    expect(result.current.data).toEqual([
      { documentId: 'doc-2', name: 'Aria', imageUrl: 'http://signed/aria.webp' },
    ]);
  });

  it('does not fetch while disabled', () => {
    renderHookWithProviders(() => useMyCharacters('room-1', false));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
