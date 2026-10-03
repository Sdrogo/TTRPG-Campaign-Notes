import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { toStoredImage } from '../lib/images';
import type { Document, DocumentVisibility } from '../types/document';
import type { RawImage } from '../types/image';
import { toNote, type RawNote } from '../lib/notes';
import { toDocumentFile, type RawDocumentFile } from '../lib/documentFiles';
import { charactersQueryKey } from './useCharacters';
import { MY_REVEALS_QUERY_KEY, revealVisitQueryKey } from './queryKeys';
import { toRevealedInDocument, type RawRevealedInDocument } from './useReveals';

interface RawDocument {
  id: string;
  room_id: string;
  name: string;
  description: string;
  visibility: DocumentVisibility;
  images: RawImage[];
  tag_ids: string[];
  owner_ids: string[];
  selective_user_ids: string[];
  played_by: string | null;
  // Only the single-Document responses carry Notes and files, not the list.
  notes?: RawNote[];
  files?: RawDocumentFile[];
  // Only the list carries it (spec 19b); null for a Document never opened.
  unread_count?: number | null;
}

function toDocument(raw: RawDocument): Document {
  return {
    id: raw.id,
    roomId: raw.room_id,
    name: raw.name,
    description: raw.description,
    visibility: raw.visibility,
    // Already favorite-first: the backend orders the gallery, so the card
    // and the detail page never disagree about which image leads.
    images: raw.images.map(toStoredImage),
    tagIds: raw.tag_ids,
    ownerIds: raw.owner_ids,
    selectiveUserIds: raw.selective_user_ids,
    playedBy: raw.played_by,
    notes: (raw.notes ?? []).map(toNote),
    files: (raw.files ?? []).map(toDocumentFile),
    unreadCount: raw.unread_count,
  };
}

function documentsQueryKey(roomId: string) {
  return ['rooms', roomId, 'documents'] as const;
}

/** The cache key of one Document; Comments, Notes and files reload it on change. */
export function documentQueryKey(roomId: string, documentId: string) {
  return ['rooms', roomId, 'documents', documentId] as const;
}

/** The Room's Documents the viewer can see, each with its Tags, Owners and visible images. */
export function useDocuments(roomId: string, enabled: boolean) {
  return useQuery<Document[]>({
    queryKey: documentsQueryKey(roomId),
    queryFn: async () =>
      (await apiFetch<RawDocument[]>(`/rooms/${roomId}/documents`)).map(toDocument),
    enabled,
  });
}

/**
 * One Document. A 404 means it doesn't exist or the viewer can't see it - the
 * backend doesn't say which.
 */
export function useDocument(roomId: string, documentId: string, enabled: boolean) {
  return useQuery<Document>({
    queryKey: documentQueryKey(roomId, documentId),
    queryFn: async () =>
      toDocument(await apiFetch<RawDocument>(`/rooms/${roomId}/documents/${documentId}`)),
    enabled,
  });
}

interface RawDocumentRead {
  last_read_at: string;
  previous_read_at: string | null;
  revealed: RawRevealedInDocument;
}

/**
 * Records one visit to a Document's page (spec 19b) once `ready` (the Thread
 * has loaded), and returns when the viewer had opened it before: the page
 * marks what was posted since as "New". Undefined until the visit is
 * recorded, null on a first visit (nothing is marked, Decision 4). Recorded
 * once per Document per mount; the list is reloaded so the card's count goes.
 *
 * The visit also opens what was revealed to the viewer in the Document (spec
 * 22 Decision 3): that goes to the cache for `useRevealedInVisit`, and the
 * header's count of unseen Reveals is reloaded.
 */
export function useDocumentVisit(
  roomId: string,
  documentId: string,
  ready: boolean,
): string | null | undefined {
  const queryClient = useQueryClient();
  const recorded = useRef<string | null>(null);
  const [visit, setVisit] = useState<{ documentId: string; previous: string | null }>();
  const { mutate } = useMutation({
    mutationFn: async () =>
      apiFetch<RawDocumentRead>(`/rooms/${roomId}/documents/${documentId}/read`, {
        method: 'POST',
      }),
    onSuccess: (read) => {
      setVisit({ documentId, previous: read.previous_read_at });
      queryClient.setQueryData(
        revealVisitQueryKey(roomId, documentId),
        toRevealedInDocument(read.revealed),
      );
      void queryClient.invalidateQueries({ queryKey: documentsQueryKey(roomId), exact: true });
      void queryClient.invalidateQueries({ queryKey: MY_REVEALS_QUERY_KEY });
    },
  });

  useEffect(() => {
    if (ready && recorded.current !== documentId) {
      recorded.current = documentId;
      mutate();
    }
  }, [ready, documentId, mutate]);

  return visit?.documentId === documentId ? visit.previous : undefined;
}

/** The fields a Document is created or updated with. An update sends only the fields given. */
export interface DocumentInput {
  name: string;
  description?: string;
  visibility?: DocumentVisibility;
  tagIds?: string[];
  selectiveUserIds?: string[];
}

function toBody(input: Partial<DocumentInput>) {
  return {
    name: input.name,
    description: input.description,
    visibility: input.visibility,
    tag_ids: input.tagIds,
    selective_user_ids: input.selectiveUserIds,
  };
}

/** Creates a Document with the current user as Owner. */
export function useCreateDocument(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DocumentInput) =>
      toDocument(
        await apiFetch<RawDocument>(`/rooms/${roomId}/documents`, {
          method: 'POST',
          json: toBody(input),
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: documentsQueryKey(roomId) });
    },
  });
}

/** Updates a Document's fields, Tags or Selective grants. */
export function useUpdateDocument(roomId: string, documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<DocumentInput>) =>
      toDocument(
        await apiFetch<RawDocument>(`/rooms/${roomId}/documents/${documentId}`, {
          method: 'PATCH',
          json: toBody(input),
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: documentsQueryKey(roomId) });
      void queryClient.invalidateQueries({ queryKey: documentQueryKey(roomId, documentId) });
    },
  });
}

/** Makes a member an Owner of the Document. */
export function useAddDocumentOwner(roomId: string, documentId: string) {
  const invalidate = useInvalidateDocument(roomId, documentId);
  return useMutation({
    mutationFn: async (userId: string) =>
      toDocument(
        await apiFetch<RawDocument>(`/rooms/${roomId}/documents/${documentId}/owners/${userId}`, {
          method: 'POST',
        }),
      ),
    // Owners show on the list's cards too, not only on the detail page.
    onSuccess: invalidate,
  });
}

/** Removes an explicit Owner. The Master stays an implicit Owner. */
export function useRemoveDocumentOwner(roomId: string, documentId: string) {
  const invalidate = useInvalidateDocument(roomId, documentId);
  return useMutation({
    mutationFn: async (userId: string) => {
      await apiFetch<void>(`/rooms/${roomId}/documents/${documentId}/owners/${userId}`, {
        method: 'DELETE',
      });
    },
    // Owners show on the list's cards too, not only on the detail page.
    onSuccess: invalidate,
  });
}

/** What `useSetDocumentPlayer` sends: the new player (null unlinks) and whether to make them an Owner. */
export interface SetPlayerInput {
  userId: string | null;
  addAsOwner: boolean;
}

/**
 * Links the Document to the member who plays it as their Character, or
 * unlinks it (UC-21). Owners and the Master only; with `addAsOwner` the
 * player also becomes an Owner, so they can edit their sheet.
 */
export function useSetDocumentPlayer(roomId: string, documentId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateDocument(roomId, documentId);
  return useMutation({
    mutationFn: async ({ userId, addAsOwner }: SetPlayerInput) =>
      toDocument(
        await apiFetch<RawDocument>(`/rooms/${roomId}/documents/${documentId}/player`, {
          method: 'PUT',
          json: { user_id: userId, add_as_owner: addAsOwner },
        }),
      ),
    onSuccess: () => {
      invalidate();
      // Who may write as this Document changed with its player.
      void queryClient.invalidateQueries({ queryKey: charactersQueryKey(roomId) });
    },
  });
}

function useInvalidateDocument(roomId: string, documentId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: documentsQueryKey(roomId) });
    void queryClient.invalidateQueries({ queryKey: documentQueryKey(roomId, documentId) });
  };
}

/**
 * Uploads files to the Document one at a time. A failure keeps the earlier
 * uploads and names the file that failed.
 */
export function useUploadDocumentImages(roomId: string, documentId: string) {
  const invalidate = useInvalidateDocument(roomId, documentId);
  return useMutation({
    // Sequential, so a failure part-way through leaves the earlier files
    // uploaded and the error names the file that failed.
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        try {
          await apiFetch<RawDocument>(`/rooms/${roomId}/documents/${documentId}/images`, {
            method: 'POST',
            formData,
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(`${file.name}: ${reason}`, { cause: error });
        }
      }
    },
    onSettled: invalidate,
  });
}

/** Adds an image to a Document from a URL; the caller refreshes what shows it. */
export async function importDocumentImage(roomId: string, documentId: string, url: string): Promise<Document> {
  return toDocument(
    await apiFetch<RawDocument>(`/rooms/${roomId}/documents/${documentId}/images/from-url`, {
      method: 'POST',
      json: { url },
    }),
  );
}

/** Adds an image to the Document from a URL. */
export function useImportDocumentImage(roomId: string, documentId: string) {
  const invalidate = useInvalidateDocument(roomId, documentId);
  return useMutation({
    mutationFn: (url: string) => importDocumentImage(roomId, documentId, url),
    onSuccess: invalidate,
  });
}

/** Makes an image the one the Document leads with (spec 07). */
export function useSetFavoriteImage(roomId: string, documentId: string) {
  const invalidate = useInvalidateDocument(roomId, documentId);
  return useMutation({
    mutationFn: async (imageId: string) =>
      toDocument(
        await apiFetch<RawDocument>(
          `/rooms/${roomId}/documents/${documentId}/images/${imageId}/favorite`,
          { method: 'PUT' },
        ),
      ),
    // The card in the list leads with this image too, so both caches go.
    onSuccess: invalidate,
  });
}

/**
 * Permanently deletes the Document, along with its Comments, images and
 * Tag/Owner/Selective-grant links. Owner-only (D-12); the caller navigates
 * away on success, since the Document no longer exists to show.
 */
export function useDeleteDocument(roomId: string, documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiFetch<void>(`/rooms/${roomId}/documents/${documentId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      // Removed, not invalidated: a refetch of a Document that no longer
      // exists would just 404.
      queryClient.removeQueries({ queryKey: documentQueryKey(roomId, documentId) });
      void queryClient.invalidateQueries({ queryKey: documentsQueryKey(roomId) });
    },
  });
}

/**
 * Deletes a gallery image. If it was the favorite, the backend promotes the
 * oldest remaining image.
 */
export function useDeleteDocumentImage(roomId: string, documentId: string) {
  const invalidate = useInvalidateDocument(roomId, documentId);
  return useMutation({
    mutationFn: async (imageId: string) => {
      await apiFetch<void>(`/rooms/${roomId}/documents/${documentId}/images/${imageId}`, {
        method: 'DELETE',
      });
    },
    onSuccess: invalidate,
  });
}
