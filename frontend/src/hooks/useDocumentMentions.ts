import { createContext, useContext } from 'react';
import type { Document } from '../types/document';
import type { Tag } from '../types/tag';
import type { MentionKind, MentionTarget } from '../lib/documentMentions';

/** What mention suggestions and links read from the surrounding Room. */
export interface DocumentMentionsValue {
  roomId: string;
  /** Only the Documents the viewer can see (the backend filters the list). */
  documents: Document[];
  tags: Tag[];
  /** What the viewer may create from the popup when nothing matches. */
  canCreateDocument: boolean;
  canCreateTag: boolean;
  /** Creates a blank Document (name only) or a Tag; rejects on failure. */
  create: (kind: MentionKind, name: string) => Promise<MentionTarget>;
}

/** Provided by `DocumentMentionsProvider`; read it through `useDocumentMentions`. */
export const DocumentMentionsContext = createContext<DocumentMentionsValue | null>(null);

/**
 * The Room's Documents and Tags for mention suggestions and links, or null
 * outside a `DocumentMentionsProvider` (then text is shown and edited as plain
 * text).
 */
export function useDocumentMentions(): DocumentMentionsValue | null {
  return useContext(DocumentMentionsContext);
}
