import { createContext, useContext } from 'react';
import type { Document } from '../types/document';
import type { Tag } from '../types/tag';

export interface DocumentMentionsValue {
  roomId: string;
  // Only the Documents the viewer can see (the backend filters the list).
  documents: Document[];
  tags: Tag[];
}

export const DocumentMentionsContext = createContext<DocumentMentionsValue | null>(null);

// The Room's Documents for mention suggestions and links, or null outside a
// `DocumentMentionsProvider` (then text is shown and edited as plain text).
export function useDocumentMentions(): DocumentMentionsValue | null {
  return useContext(DocumentMentionsContext);
}
