/** What a search result is (spec 21 Decision 1). */
export type SearchKind = 'document' | 'note' | 'comment' | 'tag';

/**
 * Text with the matched words marked as `[start, end)` offsets, in the same
 * units as JavaScript string indexes (the backend counts UTF-16 code units).
 */
export interface Highlighted {
  text: string;
  highlights: Array<[number, number]>;
}

/**
 * One result. `documentId`/`documentName` say which Document it is or belongs
 * to (null for a Tag); `title` is the Document's name, the Note's title or the
 * Tag's name (null for a Comment); `excerpt` is the text around the best match
 * (null when there is none).
 */
export interface SearchHit {
  kind: SearchKind;
  id: string;
  documentId: string | null;
  documentName: string | null;
  title: Highlighted | null;
  excerpt: Highlighted | null;
}

/** The results of one kind, best first, and whether more are visible. */
export interface SearchGroup {
  items: SearchHit[];
  hasMore: boolean;
}

/** The results grouped by kind (Decision 3), as the backend returns them. */
export interface SearchResults {
  documents: SearchGroup;
  notes: SearchGroup;
  comments: SearchGroup;
  tags: SearchGroup;
}

/** What narrows a search: one kind, and Tags its results' Documents carry. */
export interface SearchFilters {
  kind: SearchKind | null;
  tagIds: string[];
}
