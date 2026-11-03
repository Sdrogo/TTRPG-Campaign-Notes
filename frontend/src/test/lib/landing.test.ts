import { describe, expect, it } from 'vitest';
import {
  blockAnchor,
  blockDocuments,
  blockInput,
  blockMaps,
  landingHref,
  sectionHref,
  sessionZeroHref,
  sessionZeroItems,
  toBlockBody,
} from '../../lib/landing';
import { block, doc, map, overview } from '../landingFixtures';

describe('the landing helpers', () => {
  it('leads each card to its page', () => {
    expect(sectionHref('r', { id: 's', kind: 'page_documents' })).toBe('/rooms/r/documents');
    expect(sectionHref('r', { id: 's', kind: 'page_maps' })).toBe('/rooms/r/maps');
    expect(sectionHref('r', { id: 's', kind: 'page_session_zero' })).toBe('/rooms/r/session-zero');
    expect(sectionHref('r', { id: 's', kind: 'custom' })).toBe('/rooms/r/sections/s');
    expect(landingHref('r')).toBe('/rooms/r');
    expect(blockAnchor('b')).toBe('block-b');
  });

  it('opens the Session 0 page on a session and a step', () => {
    expect(sessionZeroHref('r')).toBe('/rooms/r/session-zero');
    expect(sessionZeroHref('r', 'round')).toBe('/rooms/r/session-zero?session=round');
    expect(sessionZeroHref('r', 'round', 'step')).toBe('/rooms/r/session-zero?session=round&step=step');
  });

  it('sends a block back without its id and position', () => {
    const saved = block({ heading: 'PNG', groups: [['tag-1']] });
    expect(blockInput(saved)).toEqual({
      kind: 'documents',
      heading: 'PNG',
      tagIds: ['tag-1'],
      groups: [['tag-1']],
      mapKind: null,
      features: [],
      moduleId: null,
      collapsed: false,
    });
    expect(toBlockBody(blockInput(saved))).toEqual({
      kind: 'documents',
      heading: 'PNG',
      tag_ids: ['tag-1'],
      groups: [['tag-1']],
      map_kind: null,
      module_id: null,
      collapsed: false,
      features: [],
    });
  });

  it('keeps the Documents with every Tag of the block, by name', () => {
    const documents = [doc('b', 'Zeta', ['t1', 't2']), doc('a', 'Alfa', ['t1', 't2', 't3']), doc('c', 'Beta', ['t1'])];
    expect(blockDocuments(documents, block({ tag_ids: ['t1', 't2'] })).map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('keeps the maps of the block kind, by name', () => {
    const maps = [map({ id: 'm1', name: 'Zona' }), map({ id: 'm2', name: 'atlante', kind: 'geographic' }), map({ id: 'm3', name: 'Corte' })];
    expect(blockMaps(maps, block({ kind: 'maps', tag_ids: [] })).map((m) => m.id)).toEqual(['m2', 'm3', 'm1']);
    expect(blockMaps(maps, block({ kind: 'maps', tag_ids: [], map_kind: 'free' })).map((m) => m.id)).toEqual(['m3', 'm1']);
  });

  it('lists what each Session 0 feature shows', () => {
    const data = overview();
    expect(sessionZeroItems(overview({ started: false, rounds: [] }), 'sessions')).toEqual([]);
    expect(sessionZeroItems(data, 'sessions').map((item) => item.key)).toEqual(['round-1']);
    expect(sessionZeroItems(data, 'lines_veils')).toEqual([{ kind: 'linesVeils', key: 'lines-veils', counts: { must: 1, veils: 2 } }]);
    expect(sessionZeroItems(data, 'polls').map((item) => item.key)).toEqual(['poll-1']);
    expect(sessionZeroItems(data, 'retro').map((item) => item.key)).toEqual(['step-retro']);
    expect(sessionZeroItems(data, 'questions').map((item) => item.key)).toEqual(['step-questions']);
    expect(sessionZeroItems(data, 'ddi').map((item) => item.key)).toEqual(['step-ddi']);
    expect(sessionZeroItems(data, 'stars_wishes')).toEqual([]);
    // A poll step whose polls the viewer doesn't get lists nothing.
    const hidden = overview({
      rounds: [{ id: 'r', number: 1, title: null, started_at: 'x', closed_at: null, steps: [{ id: 's', kind: 'poll', position: 0, cards: 0 }] }],
    });
    expect(sessionZeroItems(hidden, 'polls')).toEqual([]);
  });
});
