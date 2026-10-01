import { describe, expect, it } from 'vitest';
import { groupTagsByCategory, sortTagsByName } from './tags';
import type { MainItem, Tag } from '../types/tag';

/** A Tag in an optional category. */
const tag = (id: string, name: string, category: string | null = null): Tag => ({
  id,
  name,
  category,
  mainPosition: null,
});

/** A Main item of the given Tag ids. */
const item = (...tagIds: string[]): MainItem => ({ tagIds });

describe('sortTagsByName', () => {
  it('orders Tags by name, ignoring case and accents', () => {
    const names = sortTagsByName([tag('a', 'zeta'), tag('b', 'Città'), tag('c', 'alfa')]).map(
      (t) => t.name,
    );
    expect(names).toEqual(['alfa', 'Città', 'zeta']);
  });

  it('does not mutate the input array', () => {
    const input = [tag('a', 'zeta'), tag('b', 'alfa')];
    sortTagsByName(input);
    expect(input.map((t) => t.name)).toEqual(['zeta', 'alfa']);
  });
});

/** The names of each entry of each group, `+`-joined for a combination. */
const names = (groups: ReturnType<typeof groupTagsByCategory>) =>
  groups.map((g) => g.entries.map((entry) => entry.map((t) => t.name).join('+')));

describe('groupTagsByCategory', () => {
  it('puts Main items first in their chosen order, then categories alphabetically, then uncategorized', () => {
    const tags = [
      tag('t1', 'Fazione', 'Faction'),
      tag('t2', 'PC', 'Type'),
      tag('t3', 'Sciolto'),
      tag('t4', 'NPC', 'Type'),
      tag('t5', 'Clima', 'Ambiente'),
    ];

    const groups = groupTagsByCategory(tags, [item('t2'), item('t4')]);

    expect(groups.map((g) => [g.isMain, g.category])).toEqual([
      [true, null],
      [false, 'Ambiente'],
      [false, 'Faction'],
      [false, null],
    ]);
    expect(names(groups)).toEqual([['PC', 'NPC'], ['Clima'], ['Fazione'], ['Sciolto']]);
  });

  // Spec 11_3: the index reads the same ordered list as the Documents grouping.
  it('lists combinations among the Main items, in the list order', () => {
    const tags = [tag('a', 'NPC'), tag('b', 'Camarilla'), tag('c', 'Anarch')];

    const groups = groupTagsByCategory(tags, [item('a', 'b'), item('a'), item('a', 'c')]);

    expect(names(groups)[0]).toEqual(['NPC+Camarilla', 'NPC', 'NPC+Anarch']);
  });

  it('lists a single Main Tag once, in the Main group, not again under its category', () => {
    const groups = groupTagsByCategory(
      [tag('t1', 'NPC', 'Type'), tag('t2', 'Mostro', 'Type')],
      [item('t1')],
    );

    expect(names(groups)).toEqual([['NPC'], ['Mostro']]);
  });

  it('keeps a Tag that is only part of a combination under its category', () => {
    const tags = [tag('a', 'NPC', 'Type'), tag('b', 'Camarilla', 'Clan')];

    const groups = groupTagsByCategory(tags, [item('a', 'b')]);

    expect(names(groups)).toEqual([['NPC+Camarilla'], ['Camarilla'], ['NPC']]);
  });

  it('ignores an item that refers to a missing Tag', () => {
    const groups = groupTagsByCategory([tag('a', 'NPC')], [item('a', 'gone')]);

    expect(names(groups)).toEqual([['NPC']]);
    expect(groups[0].isMain).toBe(false);
  });

  it('has no Main group when the Room has no Main items', () => {
    const groups = groupTagsByCategory([tag('t1', 'Sciolto')], []);

    expect(groups).toEqual([{ isMain: false, category: null, entries: [[tag('t1', 'Sciolto')]] }]);
  });

  it('returns nothing for an empty Room', () => {
    expect(groupTagsByCategory([], [])).toEqual([]);
  });
});
