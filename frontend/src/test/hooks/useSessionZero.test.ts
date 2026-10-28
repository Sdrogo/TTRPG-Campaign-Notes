import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { boardWrites, toSessionZero, type RawSessionZero } from '../../lib/sessionZero';
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
    result.current.mutate({ write: boardWrites.publish('card-1', false) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/session-zero/cards/card-1/publish', {
      method: 'POST',
      json: { anonymous: false },
    });
    expect(queryClient.getQueryData<{ revision: number }>([...key, 'open'])?.revision).toBe(4);
    expect(queryClient.getQueryState([...key, 'open'])?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState([...key, 'round-0'])?.isInvalidated).toBe(true);
  });

  // Spec 46d Decision 7: a drop shows at once, and goes back if the write fails.
  it('shows a preview at once and puts the board back when the write fails', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setDefaultOptions({ queries: { gcTime: Infinity, retry: false } });
    const key = [...sessionZeroQueryKey('room-1'), 'open'];
    queryClient.setQueryData(key, 'old');
    let fail: (error: Error) => void = () => {};
    fetchMock.mockReturnValue(new Promise((_resolve, reject) => (fail = reject)));

    const { result } = renderHookWithProviders(() => useSessionZeroWrite('room-1'), { queryClient });
    const preview = toSessionZero(rawSessionZero({ revision: 9 }) as RawSessionZero);
    result.current.mutate({ write: boardWrites.placeCard('card-1', 'col-2', null, null), preview });
    await waitFor(() => expect(queryClient.getQueryData(key)).toBe(preview));
    fail(new Error('no'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryData(key)).toBe('old');
  });

  it('leaves the board alone when a write without a preview fails', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setDefaultOptions({ queries: { gcTime: Infinity, retry: false } });
    const key = [...sessionZeroQueryKey('room-1'), 'open'];
    queryClient.setQueryData(key, 'old');
    fetchMock.mockRejectedValue(new Error('no'));
    const { result } = renderHookWithProviders(() => useSessionZeroWrite('room-1'), { queryClient });
    result.current.mutate({ write: boardWrites.publish('card-1', false) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryData(key)).toBe('old');
  });
});
