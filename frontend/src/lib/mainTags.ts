/**
 * `items` with the item at `index` moved by `offset` places (-1 = up, 1 = down).
 * A move past either end leaves the order unchanged. Used by the Main Tags
 * editor (spec 11), which reorders with buttons rather than drag and drop.
 */
export function moveItem<T>(items: readonly T[], index: number, offset: number): T[] {
  const target = index + offset;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) {
    return [...items];
  }
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
