import { describe, expect, it } from 'vitest';
import {
  isCombination,
  itemKey,
  itemLabel,
  resolveItem,
  resolveMainItems,
  sameTagSet,
} from './mainItems';
import type { Tag } from '../types/tag';

const tag = (id: string, name: string): Tag => ({ id, name, category: null, mainPosition: null });
const npc = tag('npc', 'NPC');
const place = tag('place', 'Luogo');

describe('isCombination', () => {
  it('is true from two Tags up', () => {
    expect(isCombination({ tagIds: ['a', 'b'] })).toBe(true);
    expect(isCombination({ tagIds: ['a', 'b', 'c'] })).toBe(true);
  });

  it('is false for a single Tag', () => {
    expect(isCombination({ tagIds: ['a'] })).toBe(false);
  });
});

describe('resolveItem', () => {
  it("returns the Tags in the item's order", () => {
    expect(resolveItem({ tagIds: ['place', 'npc'] }, [npc, place])).toEqual([place, npc]);
  });

  // A combination missing one of its Tags would group differently from what
  // the Administrator saved, so it's dropped whole.
  it('returns nothing when any Tag is missing', () => {
    expect(resolveItem({ tagIds: ['npc', 'gone'] }, [npc, place])).toEqual([]);
  });
});

describe('itemLabel and itemKey', () => {
  it('label joins the Tags with a plus', () => {
    expect(itemLabel([npc])).toBe('#NPC');
    expect(itemLabel([npc, place])).toBe('#NPC + #Luogo');
  });

  it('key is the ids in order', () => {
    expect(itemKey([npc, place])).toBe('npc+place');
  });
});

describe('sameTagSet', () => {
  it('ignores the order', () => {
    expect(sameTagSet(['a', 'b'], ['b', 'a'])).toBe(true);
  });

  it('is false for different Tags or sizes', () => {
    expect(sameTagSet(['a', 'b'], ['a', 'c'])).toBe(false);
    expect(sameTagSet(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('resolveMainItems', () => {
  it('resolves each item in order, singles and combinations', () => {
    const items = [{ tagIds: ['place'] }, { tagIds: ['npc', 'place'] }];

    expect(resolveMainItems(items, [npc, place])).toEqual([[place], [npc, place]]);
  });

  it('leaves out an item with a missing Tag', () => {
    const items = [{ tagIds: ['npc', 'gone'] }, { tagIds: ['npc'] }];

    expect(resolveMainItems(items, [npc, place])).toEqual([[npc]]);
  });
});
