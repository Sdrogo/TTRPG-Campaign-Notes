import { describe, expect, it } from 'vitest';
import { sortDocuments } from './documentSorting';
import type { Document } from '../types/document';

const doc = (id: string, name: string): Document => ({
  id,
  roomId: 'r',
  name,
  description: '',
  visibility: 'room',
  images: [],
  tagIds: [],
  ownerIds: [],
  selectiveUserIds: [],
});

const documents = [doc('a', 'Zanna'), doc('b', 'Città'), doc('c', 'alfa')];
const names = (list: Document[]) => list.map((d) => d.name);

describe('sortDocuments', () => {
  it('orders ascending by name, ignoring case and accents', () => {
    expect(names(sortDocuments(documents, 'name-asc'))).toEqual(['alfa', 'Città', 'Zanna']);
  });

  it('orders descending by name', () => {
    expect(names(sortDocuments(documents, 'name-desc'))).toEqual(['Zanna', 'Città', 'alfa']);
  });

  it('does not mutate the input array', () => {
    sortDocuments(documents, 'name-desc');
    expect(names(documents)).toEqual(['Zanna', 'Città', 'alfa']);
  });
});
