import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { toDocumentFile, type RawDocumentFile } from '../lib/documentFiles';
import type { DocumentFile } from '../types/documentFile';
import { documentQueryKey } from './useDocuments';

function filesPath(roomId: string, documentId: string) {
  return `/rooms/${roomId}/documents/${documentId}/files`;
}

// Like Notes, files arrive embedded in the Document's own response, so a
// change reloads that Document; the Documents list carries no files.
function useReloadDocument(roomId: string, documentId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: documentQueryKey(roomId, documentId) });
}

/**
 * Attaches one PDF to a Document (UC-20, Owners and the Master). The backend
 * answers 422 for bytes that aren't a PDF, 413 over 10 MB and 409 past 10
 * files, with a translated message.
 */
export function useUploadDocumentFile(roomId: string, documentId: string) {
  const reload = useReloadDocument(roomId, documentId);
  return useMutation({
    mutationFn: async (file: File): Promise<DocumentFile> => {
      const formData = new FormData();
      formData.append('file', file);
      return toDocumentFile(
        await apiFetch<RawDocumentFile>(filesPath(roomId, documentId), {
          method: 'POST',
          formData,
        }),
      );
    },
    onSuccess: reload,
  });
}

/** Removes a PDF from a Document for good (Owners and the Master, D-22). */
export function useDeleteDocumentFile(roomId: string, documentId: string) {
  const reload = useReloadDocument(roomId, documentId);
  return useMutation({
    mutationFn: async (fileId: string) => {
      await apiFetch<void>(`${filesPath(roomId, documentId)}/${fileId}`, { method: 'DELETE' });
    },
    onSuccess: reload,
  });
}
