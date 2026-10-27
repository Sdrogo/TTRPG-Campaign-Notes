import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { toSessionZero, type BoardWrite, type RawSessionZero } from '../lib/sessionZero';
import type { SessionZero } from '../types/sessionZero';

function sessionZeroPath(roomId: string) {
  return `/rooms/${roomId}/session-zero`;
}

/** Every cached view of a Room's Session 0, whatever round it shows. */
export function sessionZeroQueryKey(roomId: string) {
  return ['rooms', roomId, 'session-zero'] as const;
}

function roundQueryKey(roomId: string, roundId: string | null) {
  return [...sessionZeroQueryKey(roomId), roundId ?? 'open'] as const;
}

/**
 * The Session 0 page as the viewer sees it (spec 46): their drafts and every
 * published post-it, with the Retro board of `roundId` (the open round when
 * null) and the Lines & Veils board.
 */
export function useSessionZero(roomId: string, roundId: string | null) {
  return useQuery<SessionZero>({
    queryKey: roundQueryKey(roomId, roundId),
    queryFn: async () => {
      const query = roundId ? `?round_id=${encodeURIComponent(roundId)}` : '';
      return toSessionZero(await apiFetch<RawSessionZero>(`${sessionZeroPath(roomId)}${query}`));
    },
  });
}

/**
 * Sends one write to the boards (`boardWrites` in `lib/sessionZero`). Every
 * write answers with the open round's boards, which replace the open round's
 * cache at once; a closed round on screen is read again, since a promotion
 * from it changes what it shows.
 */
export function useSessionZeroWrite(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ path, method, json }: BoardWrite) =>
      toSessionZero(await apiFetch<RawSessionZero>(`${sessionZeroPath(roomId)}${path}`, { method, json })),
    onSuccess: (board) => {
      queryClient.setQueryData(roundQueryKey(roomId, null), board);
      return queryClient.invalidateQueries({
        queryKey: sessionZeroQueryKey(roomId),
        predicate: (query) => query.queryKey[3] !== 'open',
      });
    },
  });
}
