import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { toNote, toNoteBody, type RawNote } from '../lib/notes';
import type { Note, NoteFormValues } from '../types/note';
import { documentQueryKey } from './useDocuments';

function notesPath(roomId: string, documentId: string) {
  return `/rooms/${roomId}/documents/${documentId}/notes`;
}

// Notes arrive embedded in the Document's own response, so a change reloads
// that Document rather than keeping a second cache of Notes. The Documents
// list doesn't carry them, so it stays as it is.
function useReloadDocument(roomId: string, documentId: string) {
  const queryClient = useQueryClient();
  return () => {
    return queryClient.invalidateQueries({ queryKey: documentQueryKey(roomId, documentId) });
  };
}

/** Adds a Note after the Document's others (Owner or Master). */
export function useCreateNote(roomId: string, documentId: string) {
  const reload = useReloadDocument(roomId, documentId);
  return useMutation({
    mutationFn: async (values: NoteFormValues) => {
      const raw = await apiFetch<RawNote | null>(notesPath(roomId, documentId), {
        method: 'POST',
        json: toNoteBody(values),
      });
      return raw === null ? null : toNote(raw);
    },
    onSuccess: reload,
  });
}

/** Edits a Note's title, description, visibility or grants. */
export function useUpdateNote(roomId: string, documentId: string) {
  const reload = useReloadDocument(roomId, documentId);
  return useMutation({
    mutationFn: async ({ noteId, values }: { noteId: string; values: NoteFormValues }) => {
      const raw = await apiFetch<RawNote | null>(`${notesPath(roomId, documentId)}/${noteId}`, {
        method: 'PATCH',
        json: toNoteBody(values),
      });
      return raw === null ? null : toNote(raw);
    },
    onSuccess: reload,
  });
}

/** Permanently deletes a Note. */
export function useDeleteNote(roomId: string, documentId: string) {
  const reload = useReloadDocument(roomId, documentId);
  return useMutation({
    mutationFn: async (noteId: string) => {
      await apiFetch<void>(`${notesPath(roomId, documentId)}/${noteId}`, { method: 'DELETE' });
    },
    onSuccess: reload,
  });
}

/**
 * Puts the Notes the viewer sees in a new order. `noteIds` must be exactly
 * those Notes: the backend answers 422 otherwise.
 */
export function useReorderNotes(roomId: string, documentId: string) {
  const reload = useReloadDocument(roomId, documentId);
  return useMutation({
    mutationFn: async (noteIds: string[]): Promise<Note[]> =>
      (
        await apiFetch<RawNote[]>(`${notesPath(roomId, documentId)}/order`, {
          method: 'PUT',
          json: { note_ids: noteIds },
        })
      ).map(toNote),
    // Reload on failure too: a 422 means the list changed under us.
    onSettled: reload,
  });
}
