import { describe, expect, it } from 'vitest';
import { filterDocumentsByTags } from './documentFilters';
import type { Document } from '../types/document';

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

const documents = [doc('a', ['npc']), doc('b', ['npc', 'place']), doc('c', [])];
const ids = (list: Document[]) => list.map((d) => d.id);

describe('filterDocumentsByTags', () => {
  it('returns everything without a filter', () => {
    expect(ids(filterDocumentsByTags(documents, []))).toEqual(['a', 'b', 'c']);
  });

  it('keeps the Documents carrying the Tag', () => {
    expect(ids(filterDocumentsByTags(documents, ['npc']))).toEqual(['a', 'b']);
  });

  it('combines several Tags with AND', () => {
    expect(ids(filterDocumentsByTags(documents, ['npc', 'place']))).toEqual(['b']);
  });

  it('returns nothing for an unknown Tag', () => {
    expect(filterDocumentsByTags(documents, ['gone'])).toEqual([]);
  });
});
