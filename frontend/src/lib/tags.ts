import { currentLanguage } from '../i18n';
import type { Tag } from '../types/tag';

/**
 * The category the default Tags (NPC, PC, Place, Event, Artifact) are seeded
 * with (D-14, FR-N1, `app/domain/rooms.py::DEFAULT_TAGS`) - the Room's "Main
 * Tags" that spec `10 - UX Refinment` groups the Documents list by.
 */
export const MAIN_TAG_CATEGORY = 'Type';

/** Whether `tag` is one of the Room's Main Tags. */
export function isMainTag(tag: Tag): boolean {
  return tag.category === MAIN_TAG_CATEGORY;
}

/** Tags ordered by name, in the UI's current language. */
export function sortTagsByName(tags: Tag[]): Tag[] {
  const language = currentLanguage();
  return [...tags].sort((a, b) => a.name.localeCompare(b.name, language, { sensitivity: 'base' }));
}

/** One category's Tags, sorted by name. */
export interface TagGroup {
  category: string | null;
  tags: Tag[];
}

/**
 * Buckets `tags` by category: Main Tags first, then other categories
 * alphabetically, then uncategorized Tags last - the order the Glossary/Tag
 * index sidebar lists them in (spec 10).
 */
export function groupTagsByCategory(tags: Tag[]): TagGroup[] {
  const byCategory = new Map<string | null, Tag[]>();
  for (const tag of tags) {
    const list = byCategory.get(tag.category) ?? [];
    list.push(tag);
    byCategory.set(tag.category, list);
  }

  const language = currentLanguage();
  const otherCategories = [...byCategory.keys()]
    .filter((category): category is string => category !== null && category !== MAIN_TAG_CATEGORY)
    .sort((a, b) => a.localeCompare(b, language, { sensitivity: 'base' }));

  const orderedKeys: (string | null)[] = [
    ...(byCategory.has(MAIN_TAG_CATEGORY) ? [MAIN_TAG_CATEGORY] : []),
    ...otherCategories,
    ...(byCategory.has(null) ? [null] : []),
  ];

  return orderedKeys.map((category) => ({
    category,
    tags: sortTagsByName(byCategory.get(category) ?? []),
  }));
}
