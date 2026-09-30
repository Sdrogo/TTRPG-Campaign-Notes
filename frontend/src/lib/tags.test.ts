import { describe, expect, it } from 'vitest';
import { groupTagsByCategory, isMainTag, sortMainTags, sortTagsByName } from './tags';
import type { Tag } from '../types/tag';

const tag = (
  id: string,
  name: string,
  category: string | null,
  mainPosition: number | null = null,
): Tag => ({ id, name, category, mainPosition });

describe('isMainTag', () => {
  // Spec 11: a Main Tag is decided by the Room's Administrators, not by its
  // category.
  it('is true for a Tag with a position, whatever its category', () => {
    expect(isMainTag(tag('t1', 'NPC', 'Type', 0))).toBe(true);
    expect(isMainTag(tag('t1', 'Fazione', null, 3))).toBe(true);
  });

  it('is false without a position, even in the "Type" category', () => {
    expect(isMainTag(tag('t1', 'NPC', 'Type'))).toBe(false);
  });
});

describe('sortMainTags', () => {
  it('orders by the chosen position, not by name', () => {
    const tags = [tag('a', 'Alfa', null, 2), tag('b', 'Beta', null, 0), tag('c', 'Gamma', null, 1)];

    expect(sortMainTags(tags).map((t) => t.name)).toEqual(['Beta', 'Gamma', 'Alfa']);
  });

  it('leaves out Tags that are not Main Tags', () => {
    const tags = [tag('a', 'Alfa', null, 0), tag('b', 'Beta', 'Type')];

    expect(sortMainTags(tags).map((t) => t.name)).toEqual(['Alfa']);
  });

  it('does not mutate the input array', () => {
    const input = [tag('a', 'Alfa', null, 1), tag('b', 'Beta', null, 0)];
    sortMainTags(input);
    expect(input.map((t) => t.name)).toEqual(['Alfa', 'Beta']);
  });
});

describe('sortTagsByName', () => {
  it('orders Tags by name, ignoring case and accents', () => {
    const names = sortTagsByName([
      tag('a', 'zeta', null),
      tag('b', 'Città', null),
      tag('c', 'alfa', null),
    ]).map((t) => t.name);
    expect(names).toEqual(['alfa', 'Città', 'zeta']);
  });

  it('does not mutate the input array', () => {
    const input = [tag('a', 'zeta', null), tag('b', 'alfa', null)];
    sortTagsByName(input);
    expect(input.map((t) => t.name)).toEqual(['zeta', 'alfa']);
  });
});

describe('groupTagsByCategory', () => {
  it('puts Main Tags first in their chosen order, then categories alphabetically, then uncategorized', () => {
    const tags = [
      tag('t1', 'Fazione', 'Faction'),
      tag('t2', 'PC', 'Type', 0),
      tag('t3', 'Sciolto', null),
      tag('t4', 'NPC', 'Type', 1),
      tag('t5', 'Clima', 'Ambiente'),
    ];

    const groups = groupTagsByCategory(tags);

    expect(groups.map((g) => [g.isMain, g.category])).toEqual([
      [true, null],
      [false, 'Ambiente'],
      [false, 'Faction'],
      [false, null],
    ]);
    expect(groups[0].tags.map((t) => t.name)).toEqual(['PC', 'NPC']);
    expect(groups[3].tags.map((t) => t.name)).toEqual(['Sciolto']);
  });

  it('lists a Main Tag once, in the Main group, not again under its category', () => {
    const groups = groupTagsByCategory([tag('t1', 'NPC', 'Type', 0), tag('t2', 'Mostro', 'Type')]);

    expect(groups.map((g) => g.tags.map((t) => t.name))).toEqual([['NPC'], ['Mostro']]);
  });

  it('has no Main group when the Room has no Main Tags', () => {
    const groups = groupTagsByCategory([tag('t1', 'Sciolto', null)]);
    expect(groups).toEqual([{ isMain: false, category: null, tags: [tag('t1', 'Sciolto', null)] }]);
  });

  it('returns nothing for an empty Room', () => {
    expect(groupTagsByCategory([])).toEqual([]);
  });
});
