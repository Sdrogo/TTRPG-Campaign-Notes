import { describe, expect, it } from 'vitest';
import { UNGROUPED_LABEL, groupDocumentsByMainTag } from './documentGrouping';
import type { Document } from '../types/document';
import type { Tag } from '../types/tag';

const tag = (
  id: string,
  name: string,
  category: string | null,
  mainPosition: number | null = null,
): Tag => ({
  id,
  name,
  category,
  mainPosition,
});
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

const npc = tag('npc', 'NPC', 'Type', 0);
const pc = tag('pc', 'PC', 'Type', 1);
const faction = tag('faction', 'Fazione', 'Faction');

describe('groupDocumentsByMainTag', () => {
  it('groups a Document under its Main Tag', () => {
    const groups = groupDocumentsByMainTag([doc('a', ['npc'])], [npc, pc]);

    expect(groups).toEqual([{ tag: npc, documents: [doc('a', ['npc'])] }]);
  });

  // Spec 11: the Room's Administrators order the groups, not the alphabet.
  it("orders groups by the Main Tags' chosen position", () => {
    const first = tag('pc', 'PC', 'Type', 0);
    const second = tag('npc', 'NPC', 'Type', 1);
    const groups = groupDocumentsByMainTag([doc('a', ['npc']), doc('b', ['pc'])], [second, first]);

    expect(groups.map((g) => g.tag?.name)).toEqual(['PC', 'NPC']);
  });

  it('does not group by a Tag that lost its Main Tag status, even in category "Type"', () => {
    const demoted = tag('npc', 'NPC', 'Type');
    const groups = groupDocumentsByMainTag([doc('a', ['npc'])], [demoted]);

    expect(groups).toEqual([{ tag: null, documents: [doc('a', ['npc'])] }]);
  });

  it('puts a Document with several Main Tags in every one of their groups', () => {
    const groups = groupDocumentsByMainTag([doc('a', ['npc', 'pc'])], [npc, pc]);

    expect(groups.map((g) => g.documents.map((d) => d.id))).toEqual([['a'], ['a']]);
  });

  it("ignores a non-Main Tag when deciding a Document's group", () => {
    const groups = groupDocumentsByMainTag([doc('a', ['faction'])], [npc, faction]);

    expect(groups).toEqual([{ tag: null, documents: [doc('a', ['faction'])] }]);
  });

  it('falls back to the ungrouped bucket, listed last', () => {
    const groups = groupDocumentsByMainTag([doc('a', ['npc']), doc('b', [])], [npc]);

    expect(groups.map((g) => g.tag?.name ?? UNGROUPED_LABEL)).toEqual(['NPC', UNGROUPED_LABEL]);
  });

  it('omits a Main Tag with no Documents', () => {
    const groups = groupDocumentsByMainTag([doc('a', ['npc'])], [npc, pc]);

    expect(groups.map((g) => g.tag?.name)).toEqual(['NPC']);
  });

  it('returns nothing for an empty list', () => {
    expect(groupDocumentsByMainTag([], [npc])).toEqual([]);
  });
});
