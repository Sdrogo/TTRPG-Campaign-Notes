import { isMainTag, sortTagsByName } from './tags';
import type { Document } from '../types/document';
import type { Tag } from '../types/tag';

/** How the Documents list buckets its cards (spec 10's grouping control). */
export type DocumentGroupBy = 'main-tag' | 'none';

/** The grouping applied when `?groupBy=` is absent from the URL. */
export const DEFAULT_GROUP_BY: DocumentGroupBy = 'main-tag';

/** Heading for Documents carrying none of the Room's Main Tags. */
export const UNGROUPED_LABEL = 'Senza Tag principale';

/** One Main Tag's Documents, or the `null`-tag fallback group. */
export interface DocumentGroup {
  tag: Tag | null;
  documents: Document[];
}

/**
 * Buckets `documents` by each Main Tag (category "Type", spec 10) they carry -
 * a Document with several Main Tags appears in every one of their groups -
 * with a trailing `UNGROUPED_LABEL` group for Documents carrying none. Groups
 * are ordered by Tag name; empty groups are left out.
 */
export function groupDocumentsByMainTag(documents: Document[], tags: Tag[]): DocumentGroup[] {
  const mainTags = sortTagsByName(tags.filter(isMainTag));
  const mainTagIds = new Set(mainTags.map((tag) => tag.id));

  const groups: DocumentGroup[] = mainTags.map((tag) => ({
    tag,
    documents: documents.filter((document) => document.tagIds.includes(tag.id)),
  }));

  const ungrouped = documents.filter(
    (document) => !document.tagIds.some((id) => mainTagIds.has(id)),
  );
  if (ungrouped.length > 0) {
    groups.push({ tag: null, documents: ungrouped });
  }

  return groups.filter((group) => group.documents.length > 0);
}
