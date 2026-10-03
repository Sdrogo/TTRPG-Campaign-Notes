import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import type { BacklinkGroup, BacklinkSource, BacklinkTarget } from '../types/backlink';

interface RawBacklink {
  kind: BacklinkSource;
  note_id: string | null;
  note_title: string | null;
  comment_id: string | null;
  comment_author_id: string | null;
  excerpt: string;
}

interface RawBacklinkGroup {
  document_id: string;
  document_name: string;
  mentions: RawBacklink[];
}

function toBacklinkGroup(raw: RawBacklinkGroup): BacklinkGroup {
  return {
    documentId: raw.document_id,
    documentName: raw.document_name,
    mentions: raw.mentions.map((mention) => ({
      kind: mention.kind,
      noteId: mention.note_id,
      noteTitle: mention.note_title,
      commentId: mention.comment_id,
      commentAuthorId: mention.comment_author_id,
      excerpt: mention.excerpt,
    })),
  };
}

function backlinksPath(roomId: string, target: BacklinkTarget) {
  const collection = target.kind === 'document' ? 'documents' : 'tags';
  return `/rooms/${roomId}/${collection}/${target.id}/backlinks`;
}

/**
 * Where a Document or a Tag is mentioned, as the viewer may see it (spec
 * 20). Keyed under the Room's Documents, so whatever refreshes them after a
 * save refreshes this too.
 */
export function useBacklinks(roomId: string, target: BacklinkTarget) {
  return useQuery<BacklinkGroup[]>({
    queryKey: ['rooms', roomId, 'documents', 'backlinks', target.kind, target.id],
    queryFn: async () =>
      (await apiFetch<RawBacklinkGroup[]>(backlinksPath(roomId, target))).map(toBacklinkGroup),
  });
}
