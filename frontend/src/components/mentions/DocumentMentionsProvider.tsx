import { useMemo, type ReactNode } from 'react';
import { useCreateDocument, useDocuments } from '../../hooks/useDocuments';
import { useCreateTag, useTags } from '../../hooks/useTags';
import { useMembers } from '../../hooks/useMembers';
import { useRoom } from '../../hooks/useRooms';
import { DocumentMentionsContext } from '../../hooks/useDocumentMentions';
import { canCreateDocuments, canManageTags } from '../../lib/roomPermissions';
import type { MentionKind, MentionTarget } from '../../lib/documentMentions';

interface DocumentMentionsProviderProps {
  roomId: string;
  currentUserId: string;
  children: ReactNode;
}

/**
 * Makes a Room's Documents and Tags (and the ability to create them) available
 * to every `MentionTextarea` and `MentionText` below it, so they don't have to
 * be passed down by hand. Shares the pages' cached queries (Documents, Tags,
 * members, Room), so it adds few or no requests.
 */
export function DocumentMentionsProvider({ roomId, currentUserId, children }: DocumentMentionsProviderProps) {
  const documents = useDocuments(roomId, true);
  const tags = useTags(roomId, true);
  const members = useMembers(roomId, true);
  const room = useRoom(roomId, true);
  const { mutateAsync: createDocument } = useCreateDocument(roomId);
  const { mutateAsync: createTag } = useCreateTag(roomId);

  const me = members.data?.find((member) => member.userId === currentUserId);
  const canCreateDocument = canCreateDocuments(me, room.data);
  const canCreateTag = canManageTags(me);

  const value = useMemo(() => {
    // A new blank Document gets the backend's default visibility (Room).
    const create = async (kind: MentionKind, name: string): Promise<MentionTarget> =>
      kind === 'document'
        ? { kind, document: await createDocument({ name }), tags: [] }
        : { kind, tag: await createTag({ name }), documentCount: 0 };
    return {
      roomId,
      documents: documents.data ?? [],
      tags: tags.data ?? [],
      canCreateDocument,
      canCreateTag,
      create,
    };
  }, [roomId, documents.data, tags.data, canCreateDocument, canCreateTag, createDocument, createTag]);

  return <DocumentMentionsContext value={value}>{children}</DocumentMentionsContext>;
}
