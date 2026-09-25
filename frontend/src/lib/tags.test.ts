import { describe, expect, it } from 'vitest';
import { MAIN_TAG_CATEGORY, groupTagsByCategory, isMainTag, sortTagsByName } from './tags';
import type { Tag } from '../types/tag';

const tag = (id: string, name: string, category: string | null): Tag => ({ id, name, category });

describe('isMainTag', () => {
  it('is true for the "Type" category the default Tags use', () => {
    expect(isMainTag(tag('t1', 'NPC', 'Type'))).toBe(true);
  });

  it('is false for any other category, including none', () => {
    expect(isMainTag(tag('t1', 'Fazione', 'Faction'))).toBe(false);
    expect(isMainTag(tag('t1', 'Fazione', null))).toBe(false);
  });
});

describe('sortTagsByName', () => {
  it('orders Tags by name, ignoring case and accents', () => {
    const names = sortTagsByName([tag('a', 'zeta', null), tag('b', 'Città', null), tag('c', 'alfa', null)]).map(
      (t) => t.name,
    );
    expect(names).toEqual(['alfa', 'Città', 'zeta']);
  });

  it('does not mutate the input array', () => {
    const input = [tag('a', 'zeta', null), tag('b', 'alfa', null)];
    sortTagsByName(input);
    expect(input.map((t) => t.name)).toEqual(['zeta', 'alfa']);
  });
});

describe('groupTagsByCategory', () => {
  it('puts Main Tags first, other categories alphabetically, then uncategorized last', () => {
    const tags = [
      tag('t1', 'Fazione', 'Faction'),
      tag('t2', 'PC', MAIN_TAG_CATEGORY),
      tag('t3', 'Sciolto', null),
      tag('t4', 'NPC', MAIN_TAG_CATEGORY),
      tag('t5', 'Clima', 'Ambiente'),
    ];

    const groups = groupTagsByCategory(tags);

    expect(groups.map((g) => g.category)).toEqual([MAIN_TAG_CATEGORY, 'Ambiente', 'Faction', null]);
    expect(groups[0].tags.map((t) => t.name)).toEqual(['NPC', 'PC']);
    expect(groups[3].tags.map((t) => t.name)).toEqual(['Sciolto']);
  });

  it('omits a category with no Tags', () => {
    const groups = groupTagsByCategory([tag('t1', 'Sciolto', null)]);
    expect(groups).toEqual([{ category: null, tags: [tag('t1', 'Sciolto', null)] }]);
  });

  it('returns nothing for an empty Room', () => {
    expect(groupTagsByCategory([])).toEqual([]);
  });
});
