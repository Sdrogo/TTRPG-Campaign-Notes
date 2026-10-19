import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import type {
  AppliedMentionSuggestions,
  MentionSuggestion,
  MentionSuggestionKind,
  MentionSuggestionSource,
} from '../types/mentionSuggestion';

interface RawMentionSuggestion {
  start: number;
  end: number;
  text: string;
  kind: MentionSuggestionKind;
  target_id: string;
  target_name: string;
  before: string;
  after: string;
}

interface RawMentionSuggestionSource {
  document_id: string;
  document_name: string;
  note_id: string | null;
  note_title: string | null;
  matches: RawMentionSuggestion[];
}

function toSource(raw: RawMentionSuggestionSource): MentionSuggestionSource {
  return {
    documentId: raw.document_id,
    documentName: raw.document_name,
    noteId: raw.note_id,
    noteTitle: raw.note_title,
    matches: raw.matches.map((match) => ({
      start: match.start,
      end: match.end,
      text: match.text,
      kind: match.kind,
      targetId: match.target_id,
      targetName: match.target_name,
      before: match.before,
      after: match.after,
    })),
  };
}

/**
 * The mentions to propose (spec 39) in one Document, or in every Document of
 * the Room the viewer manages when `documentId` is null. Read afresh on every
 * opening of the dialog and never kept, since any edit can change them.
 */
export function useMentionSuggestions(roomId: string, documentId: string | null) {
  const path = documentId
    ? `/rooms/${roomId}/documents/${documentId}/mention-suggestions`
    : `/rooms/${roomId}/mention-suggestions`;
  return useQuery<MentionSuggestionSource[]>({
    queryKey: ['mention-suggestions', roomId, documentId ?? 'room'],
    queryFn: async () =>
      (await apiFetch<{ sources: RawMentionSuggestionSource[] }>(path)).sources.map(toSource),
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
}

/** The proposals chosen in one text, to apply. */
export interface ChosenMentions {
  documentId: string;
  noteId: string | null;
  matches: MentionSuggestion[];
}

/**
 * Writes the chosen proposals as mentions (spec 39). Reloads everything kept
 * under the Room's Documents (the Documents, their Notes, histories,
 * "Mentioned in" lists and mention maps), since any of them may change. A
 * 409 means a text changed since the preview: reload it.
 */
export function useApplyMentionSuggestions(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chosen: ChosenMentions[]) =>
      apiFetch<AppliedMentionSuggestions>(`/rooms/${roomId}/mention-suggestions/apply`, {
        method: 'POST',
        json: {
          sources: chosen.map((source) => ({
            document_id: source.documentId,
            note_id: source.noteId,
            matches: source.matches.map((match) => ({
              start: match.start,
              end: match.end,
              kind: match.kind,
              target_id: match.targetId,
            })),
          })),
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'documents'] }),
  });
}
