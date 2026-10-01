import { resolveMainItems } from './mainItems';
import { currentLanguage } from '../i18n';
import type { MainItem, Tag } from '../types/tag';

/** Tags ordered by name, in the UI's current language. */
export function sortTagsByName(tags: Tag[]): Tag[] {
  const language = currentLanguage();
  return [...tags].sort((a, b) => a.name.localeCompare(b.name, language, { sensitivity: 'base' }));
}

/**
 * One group in the Glossary/Tag index: the Room's Main items, or a category.
 * Each entry is the Tags of one link - one Tag, or several for a combination.
 */
export interface TagGroup {
  /** True for the Main items group, which keeps the Administrators' order. */
  isMain: boolean;
  category: string | null;
  entries: Tag[][];
}

/**
 * Buckets `tags` for the Glossary/Tag index sidebar (specs 10, 11, 11_3). The
 * first group is the Room's Main items - single Tags and combinations - in
 * exactly the order the Documents page groups by, taken from the same
 * `items` list. The remaining Tags follow by category alphabetically,
 * uncategorized last; a Tag that is a single Main item is listed only in the
 * first group, while one that only appears inside combinations keeps its
 * place in its category.
 */
export function groupTagsByCategory(tags: Tag[], items: MainItem[]): TagGroup[] {
  const mainEntries = resolveMainItems(items, tags);
  const singleIds = new Set(
    mainEntries.filter((entry) => entry.length === 1).map((entry) => entry[0].id),
  );

  const byCategory = new Map<string | null, Tag[]>();
  for (const tag of tags.filter((t) => !singleIds.has(t.id))) {
    const list = byCategory.get(tag.category) ?? [];
    list.push(tag);
    byCategory.set(tag.category, list);
  }

  const language = currentLanguage();
  const categories = [...byCategory.keys()]
    .filter((category): category is string => category !== null)
    .sort((a, b) => a.localeCompare(b, language, { sensitivity: 'base' }));
  // Each key came straight from `byCategory` above, so it's there.
  const orderedKeys: (string | null)[] = [...categories, ...(byCategory.has(null) ? [null] : [])];

  return [
    ...(mainEntries.length > 0 ? [{ isMain: true, category: null, entries: mainEntries }] : []),
    ...orderedKeys.map((category) => ({
      isMain: false,
      category,
      entries: sortTagsByName(byCategory.get(category) as Tag[]).map((tag) => [tag]),
    })),
  ];
}
