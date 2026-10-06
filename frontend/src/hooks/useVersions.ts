import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import {
  toVersion,
  toVersionDetail,
  type RawVersion,
  type RawVersionDetail,
} from '../lib/versions';
import type { Version, VersionDetail } from '../types/version';
import { documentQueryKey } from './useDocuments';

function versionsPath(roomId: string, documentId: string) {
  return `/rooms/${roomId}/documents/${documentId}/versions`;
}

// Under the Document's own key, so every save that reloads the Document (its
// edits, and its Notes') reloads the history with it.
function versionsQueryKey(roomId: string, documentId: string) {
  return [...documentQueryKey(roomId, documentId), 'versions'] as const;
}

/**
 * The history of a whole Document, its Notes included, newest first (spec
 * 24b). Owners and the Master only: the backend answers 403 to anyone else, so
 * ask only for those and only while the history is open.
 */
export function useVersions(roomId: string, documentId: string, enabled: boolean) {
  return useQuery<Version[]>({
    queryKey: versionsQueryKey(roomId, documentId),
    queryFn: async () =>
      (await apiFetch<RawVersion[]>(versionsPath(roomId, documentId))).map(toVersion),
    enabled,
  });
}

/** One revision in full, for the comparison; idle while `versionId` is null. */
export function useVersion(roomId: string, documentId: string, versionId: string | null) {
  return useQuery<VersionDetail>({
    queryKey: [...versionsQueryKey(roomId, documentId), versionId],
    queryFn: async () =>
      toVersionDetail(
        await apiFetch<RawVersionDetail>(`${versionsPath(roomId, documentId)}/${versionId}`),
      ),
    enabled: versionId !== null,
  });
}

/**
 * Puts the whole Document back as it was in a revision, as a new revision. The
 * reply is only the revision now in force, so the Document (and with it its
 * Notes and its history) reloads.
 */
export function useRestoreVersion(roomId: string, documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (versionId: string) =>
      toVersionDetail(
        await apiFetch<RawVersionDetail>(
          `${versionsPath(roomId, documentId)}/${versionId}/restore`,
          {
            method: 'POST',
          },
        ),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['rooms', roomId, 'documents'],
      });
    },
  });
}
