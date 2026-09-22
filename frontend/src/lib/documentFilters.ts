import type { Document } from '../types/document';

// The Documents carrying every one of the given Tags (FR-N2: Tags combine
// with AND). No Tags means no filter.
export function filterDocumentsByTags(documents: Document[], tagIds: string[]): Document[] {
  if (tagIds.length === 0) {
    return documents;
  }
  return documents.filter((document) => tagIds.every((id) => document.tagIds.includes(id)));
}
