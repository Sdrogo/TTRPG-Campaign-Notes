import { currentLanguage } from '../i18n';
import type { Tag } from '../types/tag';

/** Whether `tag` is one of the Room's Main Tags (spec 11). */
export function isMainTag(tag: Tag): boolean {
  return tag.mainPosition !== null;
}

/**
 * The Room's Main Tags in the order an Administrator chose (spec 11), which
 * is the order the Documents list groups by. Ties (which the backend never
 * writes) fall back to the name.
 */
export function sortMainTags(tags: Tag[]): Tag[] {
  return sortTagsByName(tags.filter(isMainTag)).sort(
    (a, b) => (a.mainPosition as number) - (b.mainPosition as number),
  );
}

/** Tags ordered by name, in the UI's current language. */
export function sortTagsByName(tags: Tag[]): Tag[] {
  const language = currentLanguage();
  return [...tags].sort((a, b) => a.name.localeCompare(b.name, language, { sensitivity: 'base' }));
}

/** One group of Tags in the Glossary/Tag index: the Main Tags, or a category. */
export interface TagGroup {
  /** True for the Main Tags group, which is ordered by position, not name. */
  isMain: boolean;
  category: string | null;
  tags: Tag[];
}

/**
 * Buckets `tags` for the Glossary/Tag index sidebar (spec 10, 11): the Main
 * Tags first in their chosen order, then the remaining Tags by category
 * alphabetically, uncategorized last. A Main Tag is listed only in the first
 * group, whatever its category.
 */
export function groupTagsByCategory(tags: Tag[]): TagGroup[] {
  const mainTags = sortMainTags(tags);
  const byCategory = new Map<string | null, Tag[]>();
  for (const tag of tags.filter((t) => !isMainTag(t))) {
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
    ...(mainTags.length > 0 ? [{ isMain: true, category: null, tags: mainTags }] : []),
    ...orderedKeys.map((category) => ({
      isMain: false,
      category,
      tags: sortTagsByName(byCategory.get(category) as Tag[]),
    })),
  ];
}
