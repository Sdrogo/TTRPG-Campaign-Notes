import { useMemo, type ReactNode } from 'react';
import { useDocuments } from '../../hooks/useDocuments';
import { useTags } from '../../hooks/useTags';
import { DocumentMentionsContext } from '../../hooks/useDocumentMentions';

// Makes a Room's Documents and Tags available to every `MentionTextarea` and
// `MentionText` below it, so they don't have to be passed down by hand.
export function DocumentMentionsProvider({ roomId, children }: { roomId: string; children: ReactNode }) {
  const documents = useDocuments(roomId, true);
  const tags = useTags(roomId, true);

  const value = useMemo(
    () => ({ roomId, documents: documents.data ?? [], tags: tags.data ?? [] }),
    [roomId, documents.data, tags.data],
  );

  return <DocumentMentionsContext value={value}>{children}</DocumentMentionsContext>;
}
