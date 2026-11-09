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
import { sectionsQueryKey } from './useLanding';

/**
 * Reads the files and says what importing them would do, without writing or
 * fetching anything (`POST .../imports/preview`, spec 27 Decision 9).
 */
export function usePreviewImport(roomId: string) {
  return useMutation({
    mutationFn: async (input: File[] | PreviewImportRequest) => {
      const { files, obsidian } = Array.isArray(input)
        ? { files: input, obsidian: undefined }
        : input;
      return toImportPreview(
        await apiFetch<RawImportPreview>(`/rooms/${roomId}/imports/preview`, {
          method: 'POST',
          formData: previewFormData(files, obsidian),
        }),
      );
    },
  });
}

/** The files of a preview and whether to read them as Obsidian notes (spec 65). */
export interface PreviewImportRequest {
  files: File[];
  obsidian?: boolean;
}

/**
 * What to start the import with: the same files, the Documents chosen, which of
 * them replace, the maps chosen (spec 40), and the custom Sections and page
 * cards chosen (spec 56).
 */
export interface StartImportRequest {
  files: File[];
  /** Spec 65: read the Markdown as Obsidian notes (true), as plain Markdown (false), or detect. */
  obsidian?: boolean;
  selected: string[];
  replace: string[];
  maps: string[];
  sections: string[];
  pageCards: string[];
}

/**
 * Starts the import (`POST .../imports`, 202): the backend reads the files again,
 * so a file or a choice it would refuse is refused now; the job runs in the
 * background and `useImportJob` follows it. A 409 means one is already running.
 */
export function useStartImport(roomId: string) {
  return useMutation({
    mutationFn: async ({
      files,
      selected,
      replace,
      maps,
      sections,
      pageCards,
      obsidian,
    }: StartImportRequest) =>
      toImportJob(
        await apiFetch<RawImportJob>(`/rooms/${roomId}/imports`, {
          method: 'POST',
          formData: importFormData(files, selected, replace, maps, sections, pageCards, obsidian),
        }),
      ),
  });
}

/**
 * The import job, read every couple of seconds while it is queued or running.
 * The request never carries `X-View-As`: the job is the importer's own. When it
 * ends the Room's Documents, Tags, maps and Room home are read again, since
 * the import wrote all of them.
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
    refetchInterval: (current) =>
      isActiveImportJob(current.state.data) ? IMPORT_POLL_INTERVAL_MS : false,
  });

  const finished = query.data?.status === 'done';
  useEffect(() => {
    if (finished) {
      void queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'documents'] });
      void queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'tags'] });
      void queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'maps'] });
      void queryClient.invalidateQueries({ queryKey: sectionsQueryKey(roomId) });
    }
  }, [finished, queryClient, roomId]);

  return query;
}
