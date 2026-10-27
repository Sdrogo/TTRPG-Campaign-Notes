import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { boardWrites } from '../../lib/sessionZero';
import { rawSessionZero } from '../fixtures';
import { createTestQueryClient, renderHookWithProviders } from '../utils';
import { sessionZeroQueryKey, useSessionZero, useSessionZeroWrite } from '../../hooks/useSessionZero';

vi.mock('../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  fetchMock.mockReset();
});

describe('useSessionZero', () => {
  it('reads the open round', async () => {
    fetchMock.mockResolvedValue(rawSessionZero());
    const { result } = renderHookWithProviders(() => useSessionZero('room-1', null));
    await waitFor(() => expect(result.current.data?.retro).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/session-zero');
  });

  it('reads a closed round by its id', async () => {
    fetchMock.mockResolvedValue(rawSessionZero({ round_id: 'round 0' }));
    const { result } = renderHookWithProviders(() => useSessionZero('room-1', 'round 0'));
    await waitFor(() => expect(result.current.data?.roundId).toBe('round 0'));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/session-zero?round_id=round%200');
  });
});

describe('useSessionZeroWrite', () => {
  it("puts the answer in the open round's cache and reads a closed round again", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setDefaultOptions({ queries: { gcTime: Infinity, retry: false } });
    const key = sessionZeroQueryKey('room-1');
    queryClient.setQueryData([...key, 'open'], 'old');
    queryClient.setQueryData([...key, 'round-0'], 'old');
    fetchMock.mockResolvedValue(rawSessionZero({ revision: 4 }));

    const { result } = renderHookWithProviders(() => useSessionZeroWrite('room-1'), { queryClient });
    result.current.mutate(boardWrites.publish('card-1', false));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/session-zero/cards/card-1/publish', {
      method: 'POST',
      json: { anonymous: false },
    });
    expect(queryClient.getQueryData<{ revision: number }>([...key, 'open'])?.revision).toBe(4);
    expect(queryClient.getQueryState([...key, 'open'])?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState([...key, 'round-0'])?.isInvalidated).toBe(true);
  });
});
