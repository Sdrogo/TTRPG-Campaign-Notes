import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import type { Document, DocumentImage, DocumentVisibility } from '../types/document';

interface RawDocument {
  id: string;
  room_id: string;
  name: string;
  description: string;
  visibility: DocumentVisibility;
  images: DocumentImage[];
  tag_ids: string[];
  owner_ids: string[];
  selective_user_ids: string[];
}

function toDocument(raw: RawDocument): Document {
  return {
    id: raw.id,
    roomId: raw.room_id,
    name: raw.name,
    description: raw.description,
    visibility: raw.visibility,
    images: raw.images.map((image) => ({ id: image.id, url: image.url })),
    tagIds: raw.tag_ids,
    ownerIds: raw.owner_ids,
    selectiveUserIds: raw.selective_user_ids,
  };
}

function documentsQueryKey(roomId: string) {
  return ['rooms', roomId, 'documents'] as const;
}

function documentQueryKey(roomId: string, documentId: string) {
  return ['rooms', roomId, 'documents', documentId] as const;
}

export function useDocuments(roomId: string, enabled: boolean) {
  return useQuery<Document[]>({
    queryKey: documentsQueryKey(roomId),
    queryFn: async () =>
      (await apiFetch<RawDocument[]>(`/rooms/${roomId}/documents`)).map(toDocument),
    enabled,
  });
}

export function useDocument(roomId: string, documentId: string, enabled: boolean) {
  return useQuery<Document>({
    queryKey: documentQueryKey(roomId, documentId),
    queryFn: async () =>
      toDocument(await apiFetch<RawDocument>(`/rooms/${roomId}/documents/${documentId}`)),
    enabled,
  });
}

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

export function useAddDocumentOwner(roomId: string, documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) =>
      toDocument(
        await apiFetch<RawDocument>(`/rooms/${roomId}/documents/${documentId}/owners/${userId}`, {
          method: 'POST',
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: documentQueryKey(roomId, documentId) });
    },
  });
}

export function useRemoveDocumentOwner(roomId: string, documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      await apiFetch<void>(`/rooms/${roomId}/documents/${documentId}/owners/${userId}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: documentQueryKey(roomId, documentId) });
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

export function useImportDocumentImage(roomId: string, documentId: string) {
  const invalidate = useInvalidateDocument(roomId, documentId);
  return useMutation({
    mutationFn: async (url: string) =>
      toDocument(
        await apiFetch<RawDocument>(`/rooms/${roomId}/documents/${documentId}/images/from-url`, {
          method: 'POST',
          json: { url },
        }),
      ),
    onSuccess: invalidate,
  });
}

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
