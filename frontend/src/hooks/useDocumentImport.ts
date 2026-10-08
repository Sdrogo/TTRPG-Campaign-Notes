import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import {
  IMPORT_POLL_INTERVAL_MS,
  importFormData,
  isActiveImportJob,
  previewFormData,
  toImportJob,
  toImportPreview,
  type ImportJob,
  type RawImportJob,
  type RawImportPreview,
} from '../lib/documentImport';

/**
 * Reads the files and says what importing them would do, without writing or
 * fetching anything (`POST .../imports/preview`, spec 27 Decision 9).
 */
export function usePreviewImport(roomId: string) {
  return useMutation({
    mutationFn: async (files: File[]) =>
      toImportPreview(
        await apiFetch<RawImportPreview>(`/rooms/${roomId}/imports/preview`, {
          method: 'POST',
          formData: previewFormData(files),
        }),
      ),
  });
}

/** What to start the import with: the same files, the Documents chosen and which of them replace. */
export interface StartImportRequest {
  files: File[];
  selected: string[];
  replace: string[];
}

/**
 * Starts the import (`POST .../imports`, 202): the backend reads the files again,
 * so a file or a choice it would refuse is refused now; the job runs in the
 * background and `useImportJob` follows it. A 409 means one is already running.
 */
export function useStartImport(roomId: string) {
  return useMutation({
    mutationFn: async ({ files, selected, replace }: StartImportRequest) =>
      toImportJob(
        await apiFetch<RawImportJob>(`/rooms/${roomId}/imports`, {
          method: 'POST',
          formData: importFormData(files, selected, replace),
        }),
      ),
  });
}

/**
 * The import job, read every couple of seconds while it is queued or running.
 * The request never carries `X-View-As`: the job is the importer's own. When it
 * ends the Room's Documents, Tags and the Documents it touched are read again,
 * since the import wrote all of them.
 */
export function useImportJob(roomId: string, jobId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery<ImportJob>({
    queryKey: ['rooms', roomId, 'imports', jobId],
    queryFn: async () =>
      toImportJob(
        await apiFetch<RawImportJob>(`/rooms/${roomId}/imports/${jobId}`, { ignoreViewAs: true }),
      ),
    enabled: jobId !== null,
    refetchInterval: (current) => (isActiveImportJob(current.state.data) ? IMPORT_POLL_INTERVAL_MS : false),
  });

  const finished = query.data?.status === 'done';
  useEffect(() => {
    if (finished) {
      void queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'documents'] });
      void queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'tags'] });
    }
  }, [finished, queryClient, roomId]);

  return query;
}
