import { describe, expect, it } from 'vitest';
import { UNGROUPED_KEY, groupDocumentsByMainItems } from './documentGrouping';
import type { Document } from '../types/document';
import type { MainItem, Tag } from '../types/tag';

/** A Tag with no Main Tag position of its own: grouping follows the items. */
const tag = (id: string, name: string): Tag => ({ id, name, category: null, mainPosition: null });

/** A Document carrying the given Tag ids. */
const doc = (id: string, tagIds: string[]): Document => ({
  id,
  roomId: 'r',
  name: id,
  description: '',
  visibility: 'room',
  images: [],
  tagIds,
  ownerIds: [],
  selectiveUserIds: [],
});

/** A Main item of the given Tag ids. */
const item = (...tagIds: string[]): MainItem => ({ tagIds });

const npc = tag('npc', 'NPC');
const pc = tag('pc', 'PC');
const faction = tag('faction', 'Fazione');
const tags = [npc, pc, faction];

/** Each group's key with the ids of its Documents. */
const summary = (groups: ReturnType<typeof groupDocumentsByMainItems>) =>
  groups.map((g) => [g.key, g.documents.map((d) => d.id)]);

describe('groupDocumentsByMainItems', () => {
  it('groups a Document under its Main Tag', () => {
    const groups = groupDocumentsByMainItems([doc('a', ['npc'])], tags, [item('npc')]);

    expect(groups).toEqual([{ key: 'npc', tags: [npc], documents: [doc('a', ['npc'])] }]);
  });

  // Spec 11: the Room's Administrators order the groups, not the alphabet.
  it("follows the items' order", () => {
    const docs = [doc('a', ['npc']), doc('b', ['pc'])];

    const groups = groupDocumentsByMainItems(docs, tags, [item('pc'), item('npc')]);

    expect(groups.map((g) => g.tags[0].name)).toEqual(['PC', 'NPC']);
  });

  it('puts a Document in every item it matches', () => {
    const groups = groupDocumentsByMainItems([doc('a', ['npc', 'pc'])], tags, [
      item('npc'),
      item('pc'),
    ]);

    expect(summary(groups)).toEqual([
      ['npc', ['a']],
      ['pc', ['a']],
    ]);
  });

  // Spec 11_2: a combination holds the Documents that carry ALL its Tags.
  describe('combinations', () => {
    it('only takes Documents carrying every Tag of the combination', () => {
      const docs = [
        doc('both', ['npc', 'faction']),
        doc('one', ['npc']),
        doc('other', ['faction']),
      ];

      const groups = groupDocumentsByMainItems(docs, tags, [item('npc', 'faction')]);

      expect(summary(groups)).toEqual([
        ['npc+faction', ['both']],
        [UNGROUPED_KEY, ['one', 'other']],
      ]);
      expect(groups[0].tags).toEqual([npc, faction]);
    });

    it('sits between single items in the chosen order', () => {
      const docs = [doc('a', ['npc', 'faction'])];

      const groups = groupDocumentsByMainItems(docs, tags, [
        item('pc'),
        item('npc', 'faction'),
        item('npc'),
      ]);

      expect(groups.map((g) => g.key)).toEqual(['npc+faction', 'npc']);
    });

    it('ignores an item that refers to a missing Tag', () => {
      const groups = groupDocumentsByMainItems([doc('a', ['npc'])], tags, [item('npc', 'gone')]);

      expect(summary(groups)).toEqual([[UNGROUPED_KEY, ['a']]]);
    });
  });

  it('falls back to the ungrouped bucket, listed last', () => {
    const groups = groupDocumentsByMainItems([doc('a', ['npc']), doc('b', [])], tags, [
      item('npc'),
    ]);

    expect(groups.map((g) => g.key)).toEqual(['npc', UNGROUPED_KEY]);
    expect(groups[1].tags).toEqual([]);
  });

  it('ignores a Tag that is not a Main item when deciding the group', () => {
    const groups = groupDocumentsByMainItems([doc('a', ['faction'])], tags, [item('npc')]);

    expect(summary(groups)).toEqual([[UNGROUPED_KEY, ['a']]]);
  });

  it('omits an item with no Documents', () => {
    const groups = groupDocumentsByMainItems([doc('a', ['npc'])], tags, [item('npc'), item('pc')]);

    expect(groups.map((g) => g.key)).toEqual(['npc']);
  });

  it('puts everything in the fallback group when the Room has no items', () => {
    const groups = groupDocumentsByMainItems([doc('a', ['npc'])], tags, []);

    expect(summary(groups)).toEqual([[UNGROUPED_KEY, ['a']]]);
  });

  it('returns nothing for an empty list', () => {
    expect(groupDocumentsByMainItems([], tags, [item('npc')])).toEqual([]);
  });
});
