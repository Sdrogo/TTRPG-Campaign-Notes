import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import type { Document, DocumentVisibility } from '../types/document';

interface RawDocument {
  id: string;
  room_id: string;
  name: string;
  description: string;
  visibility: DocumentVisibility;
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
