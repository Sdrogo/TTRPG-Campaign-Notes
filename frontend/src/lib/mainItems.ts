import type { MainItem, Tag } from '../types/tag';

/** Whether `item` is a combination of Tags rather than a single Main Tag. */
export function isCombination(item: MainItem): boolean {
  return item.tagIds.length > 1;
}

/**
 * The Tags of `item` that exist in `tags`, in the item's order. An item that
 * refers to a Tag the list doesn't have resolves to nothing, so it is never
 * shown as a partial combination.
 */
export function resolveItem(item: MainItem, tags: Tag[]): Tag[] {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const resolved = item.tagIds.map((id) => byId.get(id));
  return resolved.every((tag): tag is Tag => tag !== undefined) ? resolved : [];
}

/** `#A` for a single Tag, `#A + #B` for a combination. */
export function itemLabel(tags: Tag[]): string {
  return tags.map((tag) => `#${tag.name}`).join(' + ');
}

/** A stable key for a list of Tags: the ids joined, in order. */
export function itemKey(tags: Tag[]): string {
  return tags.map((tag) => tag.id).join('+');
}

/** Whether two lists hold the same Tag ids, whatever their order. */
export function sameTagSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}
