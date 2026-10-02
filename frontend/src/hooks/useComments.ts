import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { toStoredImage } from '../lib/images';
import { toCharacter, type RawCharacter } from '../lib/characters';
import type { Comment, CommentFormValues } from '../types/comment';
import type { DocumentVisibility } from '../types/document';
import type { PendingImage, RawImage } from '../types/image';
import i18n from '../i18n';

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
  as_character: RawCharacter | null;
  parent_id: string | null;
  parent_hidden: boolean;
  reactions: RawReaction[];
  pinned_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  can_pin: boolean;
  can_resolve: boolean;
}

interface RawReaction {
  emoji: string;
  count: number;
  reacted_by_me: boolean;
  user_ids: string[];
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
    asCharacter: raw.as_character ? toCharacter(raw.as_character) : null,
    parentId: raw.parent_id,
    parentHidden: raw.parent_hidden,
    reactions: raw.reactions.map((reaction) => ({
      emoji: reaction.emoji,
      count: reaction.count,
      reactedByMe: reaction.reacted_by_me,
      userIds: reaction.user_ids,
    })),
    pinnedAt: raw.pinned_at,
    resolvedAt: raw.resolved_at,
    resolvedBy: raw.resolved_by,
    canPin: raw.can_pin,
    canResolve: raw.can_resolve,
  };
}

function toBody(
  values: Pick<CommentFormValues, 'body' | 'visibility' | 'selectiveUserIds' | 'asDocumentId'>,
) {
  return {
    body: values.body,
    visibility: values.visibility,
    // Grants only mean something at the Selective level.
    selective_user_ids: values.visibility === 'selective' ? values.selectiveUserIds : [],
    // Omitted (undefined is dropped by JSON) keeps an edited Comment's
    // Character; null writes as yourself.
    as_document_id: values.asDocumentId,
  };
}

function commentsPath(roomId: string, documentId: string) {
  return `/rooms/${roomId}/documents/${documentId}/comments`;
}

function commentsQueryKey(roomId: string, documentId: string) {
  return ['rooms', roomId, 'documents', documentId, 'comments'] as const;
}

// Puts a Comment a route returned in place of the cached one, for changes
// that touch nothing else (no image, so no Document or list refresh).
function useReplaceInThread(roomId: string, documentId: string) {
  const queryClient = useQueryClient();
  const key = commentsQueryKey(roomId, documentId);
  return (updated: Comment) => {
    queryClient.setQueryData<Comment[]>(key, (current) =>
      current?.map((comment) => (comment.id === updated.id ? updated : comment)),
    );
  };
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
        : await apiFetch<RawComment>(base, {
            method: 'POST',
            // A reply names the Comment it answers (spec 19); undefined is
            // dropped by JSON, so a top-level Comment sends nothing.
            json: { ...toBody(values), parent_id: values.parentId },
          });

      const imageErrors: string[] = [];
      const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

      for (const imageId of values.removedImageIds) {
        try {
          await apiFetch<void>(`${base}/${saved.id}/images/${imageId}`, { method: 'DELETE' });
        } catch (error) {
          imageErrors.push(i18n.t('comments.imageRemovalFailed', { reason: reason(error) }));
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

/** What `useToggleReaction` sends: add or take back the viewer's own emoji. */
export interface ToggleReactionInput {
  commentId: string;
  emoji: string;
  /** True to react, false to take the viewer's reaction back. */
  add: boolean;
}

/**
 * Adds or removes the viewer's reaction on a Comment (spec 19c Decision 1).
 * Both calls are idempotent on the backend and return the Comment, which
 * replaces it in the Thread's cache: reactions change no image, so the
 * Document and its list are left alone.
 */
export function useToggleReaction(roomId: string, documentId: string) {
  const replaceInThread = useReplaceInThread(roomId, documentId);
  return useMutation({
    mutationFn: async ({ commentId, emoji, add }: ToggleReactionInput) =>
      toComment(
        await apiFetch<RawComment>(
          `${commentsPath(roomId, documentId)}/${commentId}/reactions/${encodeURIComponent(emoji)}`,
          { method: add ? 'PUT' : 'DELETE' },
        ),
      ),
    onSuccess: replaceInThread,
  });
}

/** Pin a Comment (spec 19c Decision 3) or resolve its branch (Decision 4). */
export type CommentFlag = 'pin' | 'resolve';

/** What `useSetCommentFlag` sends: set the flag on a Comment, or clear it. */
export interface SetCommentFlagInput {
  commentId: string;
  flag: CommentFlag;
  /** True to pin or resolve, false to unpin or reopen. */
  on: boolean;
}

/**
 * Pins or unpins a Comment, or resolves or reopens its branch (spec 19c).
 * `POST`/`DELETE .../{flag}` are idempotent on the backend and return the
 * Comment, which replaces it in the Thread's cache. The backend refuses a
 * fourth pin (409) with a message to show.
 */
export function useSetCommentFlag(roomId: string, documentId: string) {
  const replaceInThread = useReplaceInThread(roomId, documentId);
  return useMutation({
    mutationFn: async ({ commentId, flag, on }: SetCommentFlagInput) =>
      toComment(
        await apiFetch<RawComment>(`${commentsPath(roomId, documentId)}/${commentId}/${flag}`, {
          method: on ? 'POST' : 'DELETE',
        }),
      ),
    onSuccess: replaceInThread,
  });
}
