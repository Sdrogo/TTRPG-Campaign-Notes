import { itemKey, resolveItem } from './mainItems';
import type { Document } from '../types/document';
import type { MainItem, Tag } from '../types/tag';

/** How the Documents list buckets its cards (spec 10's grouping control). */
export type DocumentGroupBy = 'main-tag' | 'none';

/** The grouping applied when `?groupBy=` is absent from the URL. */
export const DEFAULT_GROUP_BY: DocumentGroupBy = 'main-tag';

/** The key of the fallback group, which has no Tags. */
export const UNGROUPED_KEY = 'ungrouped';

/**
 * One line item's Documents: `tags` holds one Tag for a Main Tag or two or
 * more for a combination, and is empty for the fallback group.
 */
export interface DocumentGroup {
  key: string;
  tags: Tag[];
  documents: Document[];
}

/**
 * Buckets `documents` by the Room's Main items (specs 10, 11, 11_2). A Document
 * belongs to an item when it carries every Tag of it - one for a Main Tag, all
 * of them for a combination - and appears in every item it matches, so a
 * Document can sit under a combination and under the single Tags it is made
 * of. Groups follow the order of `items`, with a trailing fallback group for
 * Documents matching none; empty groups are left out, and an item that refers
 * to a missing Tag is ignored.
 */
export function groupDocumentsByMainItems(
  documents: Document[],
  tags: Tag[],
  items: MainItem[],
): DocumentGroup[] {
  const matched = new Set<string>();
  const groups: DocumentGroup[] = [];

  for (const item of items) {
    const itemTags = resolveItem(item, tags);
    if (itemTags.length === 0) continue;

    const inItem = documents.filter((document) =>
      itemTags.every((tag) => document.tagIds.includes(tag.id)),
    );
    inItem.forEach((document) => matched.add(document.id));
    groups.push({ key: itemKey(itemTags), tags: itemTags, documents: inItem });
  }

  const ungrouped = documents.filter((document) => !matched.has(document.id));
  groups.push({ key: UNGROUPED_KEY, tags: [], documents: ungrouped });

  return groups.filter((group) => group.documents.length > 0);
}
