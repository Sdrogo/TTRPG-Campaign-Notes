import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { MY_REVEALS_QUERY_KEY, revealVisitQueryKey } from './queryKeys';
import type { DocumentVisibility } from '../types/document';
import type {
  ContentKind,
  HistoryContentState,
  HistoryEntry,
  HistoryPage,
  MyReveal,
  RevealAudience,
  RevealedInDocument,
} from '../types/reveal';

interface RawMyReveal {
  id: string;
  room_id: string;
  kind: ContentKind;
  document_id: string;
  note_id: string | null;
  comment_id: string | null;
  revealed_at: string;
  room_name: string;
  document_name: string;
  note_title: string | null;
}

/** `RevealedInDocument` as the API sends it, inside `POST .../read`'s answer. */
export interface RawRevealedInDocument {
  document: boolean;
  note_ids: string[];
  comment_ids: string[];
}

interface RawHistoryEntry {
  id: string;
  created_at: string;
  actor_id: string;
  kind: ContentKind;
  is_reveal: boolean;
  state: HistoryContentState;
  from_visibility: DocumentVisibility;
  to_visibility: DocumentVisibility;
  document_id: string | null;
  document_name: string | null;
  note_id: string | null;
  note_title: string | null;
  comment_id: string | null;
  selective_user_ids: string[];
  recipient_ids: string[];
}

interface RawHistoryPage {
  entries: RawHistoryEntry[];
  next_before: string | null;
}

function toMyReveal(raw: RawMyReveal): MyReveal {
  return {
    id: raw.id,
    roomId: raw.room_id,
    kind: raw.kind,
    documentId: raw.document_id,
    noteId: raw.note_id,
    commentId: raw.comment_id,
    revealedAt: raw.revealed_at,
    roomName: raw.room_name,
    documentName: raw.document_name,
    noteTitle: raw.note_title,
  };
}

/** Converts what a visit opened (spec 22 Decision 3). */
export function toRevealedInDocument(raw: RawRevealedInDocument): RevealedInDocument {
  return { document: raw.document, noteIds: raw.note_ids, commentIds: raw.comment_ids };
}

function toHistoryEntry(raw: RawHistoryEntry): HistoryEntry {
  return {
    id: raw.id,
    createdAt: raw.created_at,
    actorId: raw.actor_id,
    kind: raw.kind,
    isReveal: raw.is_reveal,
    state: raw.state,
    fromVisibility: raw.from_visibility,
    toVisibility: raw.to_visibility,
    documentId: raw.document_id,
    documentName: raw.document_name,
    noteId: raw.note_id,
    noteTitle: raw.note_title,
    commentId: raw.comment_id,
    selectiveUserIds: raw.selective_user_ids,
    recipientIds: raw.recipient_ids,
  };
}

function toAudienceBody(audience: RevealAudience) {
  return { to_room: audience.toRoom, user_ids: audience.userIds };
}

/**
 * Content revealed to the signed-in user that they haven't opened yet, in
 * every Room (spec 22 Decision 3): the header badge counts it, the Account
 * page lists it and the Room's cards are marked. Refreshed on focus (D-04).
 */
export function useMyReveals(enabled: boolean) {
  return useQuery<MyReveal[]>({
    queryKey: MY_REVEALS_QUERY_KEY,
    queryFn: async () => (await apiFetch<RawMyReveal[]>('/reveals/mine')).map(toMyReveal),
    enabled,
  });
}

/**
 * What the current visit to the Document opened among the content revealed
 * to the viewer, once `useDocumentVisit` recorded it; undefined before. Only
 * reads the cache: the visit writes it.
 */
export function useRevealedInVisit(roomId: string, documentId: string) {
  return useQuery<RevealedInDocument>({
    queryKey: revealVisitQueryKey(roomId, documentId),
    // Never fetched: the visit fills the cache.
    queryFn: skipToken,
  }).data;
}

// A Reveal changes the content's visibility, and a Document's carries Notes:
// reload everything about the Room's Documents, and its history.
function useInvalidateAfterReveal(roomId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'documents'] });
    void queryClient.invalidateQueries({ queryKey: historyQueryPrefix(roomId) });
  };
}

/**
 * The Master reveals the Document (UC-13, FR-V2) to `audience`, with the
 * Notes in `noteIds` revealed to the same audience in the same step (spec 22
 * Decision 2).
 */
export function useRevealDocument(roomId: string, documentId: string) {
  const invalidate = useInvalidateAfterReveal(roomId);
  return useMutation({
    mutationFn: async (input: { audience: RevealAudience; noteIds: string[] }) => {
      await apiFetch<unknown>(`/rooms/${roomId}/documents/${documentId}/reveal`, {
        method: 'POST',
        json: { ...toAudienceBody(input.audience), note_ids: input.noteIds },
      });
    },
    onSuccess: invalidate,
  });
}

/** The Master reveals one Note of the Document to `audience`. */
export function useRevealNote(roomId: string, documentId: string) {
  const invalidate = useInvalidateAfterReveal(roomId);
  return useMutation({
    mutationFn: async (input: { noteId: string; audience: RevealAudience }) => {
      await apiFetch<unknown>(
        `/rooms/${roomId}/documents/${documentId}/notes/${input.noteId}/reveal`,
        { method: 'POST', json: toAudienceBody(input.audience) },
      );
    },
    onSuccess: invalidate,
  });
}

/** The Master reveals one Comment of the Document's Thread to `audience`. */
export function useRevealComment(roomId: string, documentId: string) {
  const invalidate = useInvalidateAfterReveal(roomId);
  return useMutation({
    mutationFn: async (input: { commentId: string; audience: RevealAudience }) => {
      await apiFetch<unknown>(
        `/rooms/${roomId}/documents/${documentId}/comments/${input.commentId}/reveal`,
        { method: 'POST', json: toAudienceBody(input.audience) },
      );
    },
    onSuccess: invalidate,
  });
}

function historyQueryPrefix(roomId: string) {
  return ['rooms', roomId, 'audit-log'] as const;
}

/**
 * The Room's visibility history (spec 22 Decision 4), newest first, a page
 * at a time, optionally only about one `kind` of content. For the Master and
 * the Administrators.
 */
export function useVisibilityHistory(roomId: string, kind: ContentKind | null, enabled: boolean) {
  return useInfiniteQuery<HistoryPage, Error, HistoryEntry[], readonly unknown[], string | null>({
    queryKey: [...historyQueryPrefix(roomId), kind],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (kind) params.set('kind', kind);
      if (pageParam) params.set('before', pageParam);
      const query = params.toString();
      const raw = await apiFetch<RawHistoryPage>(
        `/rooms/${roomId}/audit-log${query ? `?${query}` : ''}`,
      );
      return { entries: raw.entries.map(toHistoryEntry), nextBefore: raw.next_before };
    },
    initialPageParam: null,
    getNextPageParam: (last) => last.nextBefore,
    select: (data) => data.pages.flatMap((page) => page.entries),
    enabled,
  });
}
