import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import {
  pdfPollInterval,
  pdfRequestBody,
  readDismissedPdfJobs,
  saveDismissedPdfJob,
  toPdfJob,
  type PdfExportOptions,
  type PdfJob,
  type RawPdfJob,
} from '../lib/pdfExport';
import { viewAsUser } from '../lib/viewAs';

/** The cache key of the signed-in user's PDF jobs in a Room. */
export function pdfExportsQueryKey(roomId: string) {
  return ['rooms', roomId, 'pdf-exports'] as const;
}

/**
 * The signed-in user's own Room PDFs, newest first (spec 23b). Re-read every
 * few seconds while one is being made, so the dialog and the Room page follow
 * it to "ready". The request never carries `X-View-As`: a PDF made while
 * previewing a member is still the Master's own job.
 */
export function usePdfExports(roomId: string, enabled: boolean) {
  return useQuery<PdfJob[]>({
    queryKey: pdfExportsQueryKey(roomId),
    queryFn: async () =>
      (await apiFetch<RawPdfJob[]>(`/rooms/${roomId}/exports`, { ignoreViewAs: true })).map(
        toPdfJob,
      ),
    enabled,
    refetchInterval: (query) => pdfPollInterval(query.state.data),
  });
}

/**
 * Starts a Room PDF (`POST .../exports/pdf`, 202): the backend makes it in the
 * background and the job list picks it up. While the Master previews the Room
 * as a member, the member's id travels in the body so the PDF is what they
 * see (spec 22b, 23b Decision 6). A 409 means one is already being made.
 */
export function useStartPdfExport(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (options: PdfExportOptions) =>
      toPdfJob(
        await apiFetch<RawPdfJob>(`/rooms/${roomId}/exports/pdf`, {
          method: 'POST',
          json: pdfRequestBody(options, viewAsUser()),
          ignoreViewAs: true,
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pdfExportsQueryKey(roomId) }),
  });
}

function dismissedQueryKey(userId: string, roomId: string) {
  return ['rooms', roomId, 'pdf-dismissed', userId] as const;
}

/**
 * The jobs of the Room the signed-in user downloaded or hid, shared through the cache so
 * the dialog and the Room page agree, and `dismiss` to add one (kept in the
 * browser, `lib/pdfExport.ts`).
 */
export function useDismissedPdfJobs(userId: string, roomId: string) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: dismissedQueryKey(userId, roomId),
    queryFn: () => readDismissedPdfJobs(userId, roomId),
    staleTime: Infinity,
  });
  const dismiss = useCallback(
    (jobId: string) => {
      queryClient.setQueryData(
        dismissedQueryKey(userId, roomId),
        saveDismissedPdfJob(userId, roomId, jobId),
      );
    },
    [queryClient, userId, roomId],
  );
  return { dismissed: data ?? new Set<string>(), dismiss };
}
