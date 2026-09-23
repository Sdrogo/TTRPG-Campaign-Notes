import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { toStoredImage } from '../lib/images';
import type { Comment, CommentFormValues } from '../types/comment';
import type { DocumentVisibility } from '../types/document';
import type { PendingImage, RawImage } from '../types/image';

interface RawComment {
  id: string;
  document_id: string;
  author_id: string;
  body: string;
  visibility: DocumentVisibility;
  selective_user_ids: string[];
  created_at: string;
  updated_at: string;
  deleted: boolean;
  images: RawImage[];
  can_edit: boolean;
  can_delete: boolean;
}

function toComment(raw: RawComment): Comment {
  return {
    id: raw.id,
    documentId: raw.document_id,
    authorId: raw.author_id,
    body: raw.body,
    visibility: raw.visibility,
    selectiveUserIds: raw.selective_user_ids,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    deleted: raw.deleted,
    images: raw.images.map(toStoredImage),
    canEdit: raw.can_edit,
    canDelete: raw.can_delete,
  };
}

function toBody(values: Pick<CommentFormValues, 'body' | 'visibility' | 'selectiveUserIds'>) {
  return {
    body: values.body,
    visibility: values.visibility,
    // Grants only mean something at the Selective level.
    selective_user_ids: values.visibility === 'selective' ? values.selectiveUserIds : [],
  };
}

function commentsPath(roomId: string, documentId: string) {
  return `/rooms/${roomId}/documents/${documentId}/comments`;
}

function commentsQueryKey(roomId: string, documentId: string) {
  return ['rooms', roomId, 'documents', documentId, 'comments'] as const;
}

/** A Document's Comments the viewer can see, deleted placeholders included. */
export function useComments(roomId: string, documentId: string, enabled: boolean) {
  return useQuery<Comment[]>({
    queryKey: commentsQueryKey(roomId, documentId),
    queryFn: async () =>
      (await apiFetch<RawComment[]>(commentsPath(roomId, documentId))).map(toComment),
    enabled,
  });
}

// Comment images are Document images too, so any change to them also
// refreshes the Document (its gallery) and the Documents list.
function useInvalidateThread(roomId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'documents'] });
  };
}

async function attachImage(base: string, commentId: string, image: PendingImage) {
  const path = `${base}/${commentId}/images`;
  if (typeof image.source === 'string') {
    await apiFetch<RawComment>(`${path}/from-url`, { method: 'POST', json: { url: image.source } });
  } else {
    const formData = new FormData();
    formData.append('file', image.source);
    await apiFetch<RawComment>(path, { method: 'POST', formData });
  }
}

/** What `useSaveComment` saves: the form's values, and the Comment's id when editing one. */
export interface SaveCommentInput {
  /** Omitted for a new Comment. */
  commentId?: string;
  values: CommentFormValues;
}

/** The saved Comment's id, and any image change that failed after it. */
export interface SaveCommentResult {
  commentId: string;
  /**
   * Image changes that failed after the Comment itself was saved, one
   * message each ("name: reason"). The Comment is saved regardless.
   */
  imageErrors: string[];
}

/**
 * Creates or edits a Comment, then applies its image changes in order
 * (removals, then uploads one by one). An image failure doesn't undo the
 * Comment - it's reported in `imageErrors` so the form can still reset.
 */
export function useSaveComment(roomId: string, documentId: string) {
  const invalidate = useInvalidateThread(roomId);
  const base = commentsPath(roomId, documentId);

  return useMutation({
    mutationFn: async ({ commentId, values }: SaveCommentInput): Promise<SaveCommentResult> => {
      const saved = commentId
        ? await apiFetch<RawComment>(`${base}/${commentId}`, {
            method: 'PATCH',
            json: toBody(values),
          })
        : await apiFetch<RawComment>(base, { method: 'POST', json: toBody(values) });

      const imageErrors: string[] = [];
      const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

      for (const imageId of values.removedImageIds) {
        try {
          await apiFetch<void>(`${base}/${saved.id}/images/${imageId}`, { method: 'DELETE' });
        } catch (error) {
          imageErrors.push(`Rimozione immagine: ${reason(error)}`);
        }
      }
      for (const image of values.newImages) {
        try {
          await attachImage(base, saved.id, image);
        } catch (error) {
          imageErrors.push(`${image.label}: ${reason(error)}`);
        }
      }
      return { commentId: saved.id, imageErrors };
    },
    onSettled: invalidate,
  });
}

/**
 * Deletes a Comment. It stays in the list as a placeholder, and its images
 * leave the Document gallery.
 */
export function useDeleteComment(roomId: string, documentId: string) {
  const invalidate = useInvalidateThread(roomId);
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch<void>(`${commentsPath(roomId, documentId)}/${id}`, { method: 'DELETE' });
    },
    onSuccess: invalidate,
  });
}
