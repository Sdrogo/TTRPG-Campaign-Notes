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

function versionsPath(roomId: string, documentId: string, noteId?: string) {
  const base = `/rooms/${roomId}/documents/${documentId}`;
  return `${base}${noteId ? `/notes/${noteId}` : ''}/versions`;
}

// Under the Document's own key, so every save that reloads the Document (its
// edits, and its Notes') reloads the history with it.
function versionsQueryKey(roomId: string, documentId: string, noteId?: string) {
  return [...documentQueryKey(roomId, documentId), 'versions', noteId ?? 'document'] as const;
}

/**
 * The history of a Document's text, or of one Note's, newest first (spec 24).
 * Owners and the Master only: the backend answers 403 to anyone else, so ask
 * only for those and only while the history is open.
 */
export function useVersions(
  roomId: string,
  documentId: string,
  noteId: string | undefined,
  enabled: boolean,
) {
  return useQuery<Version[]>({
    queryKey: versionsQueryKey(roomId, documentId, noteId),
    queryFn: async () =>
      (await apiFetch<RawVersion[]>(versionsPath(roomId, documentId, noteId))).map(toVersion),
    enabled,
  });
}

/** One version in full, to compare with the current text; idle until one is chosen. */
export function useVersion(
  roomId: string,
  documentId: string,
  noteId: string | undefined,
  versionId: string | null,
) {
  return useQuery<VersionDetail>({
    queryKey: [...versionsQueryKey(roomId, documentId, noteId), versionId],
    queryFn: async () =>
      toVersionDetail(
        await apiFetch<RawVersionDetail>(
          `${versionsPath(roomId, documentId, noteId)}/${versionId}`,
        ),
      ),
    enabled: versionId !== null,
  });
}

/**
 * Puts an earlier text back as a new version. The reply is only the version
 * now in force, so the Document (and with it its Notes and histories) reloads.
 */
export function useRestoreVersion(roomId: string, documentId: string, noteId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (versionId: string) =>
      toVersionDetail(
        await apiFetch<RawVersionDetail>(
          `${versionsPath(roomId, documentId, noteId)}/${versionId}/restore`,
          { method: 'POST' },
        ),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['rooms', roomId, 'documents'],
      });
    },
  });
}
