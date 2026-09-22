import { describe, expect, it } from 'vitest';
import {
  filterMentionCandidates,
  findMentionQuery,
  insertMention,
  mentionKeyAction,
  moveActiveIndex,
  normalizeForSearch,
  splitMentions,
} from './documentMentions';
import type { Document } from '../types/document';
import type { Tag } from '../types/tag';

function doc(id: string, name: string, tagIds: string[] = []): Document {
  return {
    id,
    roomId: 'room',
    name,
    description: '',
    visibility: 'room',
    images: [],
    tagIds,
    ownerIds: [],
    selectiveUserIds: [],
  };
}

const tags: Tag[] = [
  { id: 't-npc', name: 'NPC', category: 'Type' },
  { id: 't-place', name: 'Place', category: 'Type' },
];

const documents = [
  doc('d-castle', 'Castle Drakon', ['t-place']),
  doc('d-count', 'Count Vlad', ['t-npc']),
  doc('d-city', 'Città Bassa', ['t-place']),
  doc('d-rome', 'Rome'),
  doc('d-romeo', 'Romeo', ['t-npc']),
];

const names = (list: { document: Document }[]) => list.map((c) => c.document.name);

describe('findMentionQuery', () => {
  it('finds a # at the start of the text', () => {
    expect(findMentionQuery('#Cas', 4)).toEqual({ start: 0, query: 'Cas' });
  });

  it('finds a # starting a word, up to the caret', () => {
    expect(findMentionQuery('see #Cas and more', 8)).toEqual({ start: 4, query: 'Cas' });
  });

  it('opens on a bare # with an empty query', () => {
    expect(findMentionQuery('hello #', 7)).toEqual({ start: 6, query: '' });
  });

  it('allows spaces, since Document names can have them', () => {
    expect(findMentionQuery('#Castle Dra', 11)).toEqual({ start: 0, query: 'Castle Dra' });
  });

  it('ignores a # inside a word', () => {
    expect(findMentionQuery('issue#12', 8)).toBeNull();
  });

  it('accepts a # after an opening bracket', () => {
    expect(findMentionQuery('(#Co', 4)).toEqual({ start: 1, query: 'Co' });
  });

  it('stops at a new line or a leading space', () => {
    expect(findMentionQuery('#Cas\ntle', 8)).toBeNull();
    expect(findMentionQuery('# Cas', 5)).toBeNull();
  });

  it('returns null without any #', () => {
    expect(findMentionQuery('plain text', 5)).toBeNull();
  });
});

describe('normalizeForSearch', () => {
  it('lowercases and strips accents', () => {
    expect(normalizeForSearch('Città Bassa')).toBe('citta bassa');
  });
});

describe('filterMentionCandidates', () => {
  it('lists every Document alphabetically for an empty query', () => {
    expect(names(filterMentionCandidates(documents, tags, ''))).toEqual([
      'Castle Drakon',
      'Città Bassa',
      'Count Vlad',
      'Rome',
      'Romeo',
    ]);
  });

  it('matches names ignoring case and accents', () => {
    expect(names(filterMentionCandidates(documents, tags, 'citta'))).toEqual(['Città Bassa']);
  });

  it('ranks name prefixes before word and substring matches', () => {
    const extra = [...documents, doc('d-ruins', 'Old Drakon Ruins'), doc('d-sub', 'Undrakonian')];
    expect(names(filterMentionCandidates(extra, tags, 'drak'))).toEqual([
      'Castle Drakon',
      'Old Drakon Ruins',
      'Undrakonian',
    ]);
  });

  it('matches by Tag, after name matches', () => {
    const extra = [...documents, doc('d-npc', 'Npc Registry')];
    expect(names(filterMentionCandidates(extra, tags, 'npc'))).toEqual([
      'Npc Registry',
      'Count Vlad',
      'Romeo',
    ]);
  });

  it('returns each Document with its Tags', () => {
    const [castle] = filterMentionCandidates(documents, tags, 'castle');
    expect(castle.tags.map((t) => t.name)).toEqual(['Place']);
  });

  it('ignores unknown Tag ids', () => {
    const [ghost] = filterMentionCandidates([doc('d-ghost', 'Ghost', ['t-gone'])], tags, '');
    expect(ghost.tags).toEqual([]);
  });

  it('respects the limit', () => {
    expect(filterMentionCandidates(documents, tags, '', 2)).toHaveLength(2);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterMentionCandidates(documents, tags, 'zzz')).toEqual([]);
  });
});

describe('insertMention', () => {
  it('replaces the typed query with the full name and a space', () => {
    const text = 'Meet #cou';
    expect(insertMention(text, { start: 5, query: 'cou' }, 9, 'Count Vlad')).toEqual({
      text: 'Meet #Count Vlad ',
      caret: 17,
    });
  });

  it('keeps the text after the caret and adds no double space', () => {
    const text = 'Meet #cou tonight';
    expect(insertMention(text, { start: 5, query: 'cou' }, 9, 'Count Vlad')).toEqual({
      text: 'Meet #Count Vlad tonight',
      caret: 16,
    });
  });
});

describe('splitMentions', () => {
  it('returns plain text when nothing is mentioned', () => {
    expect(splitMentions('no mentions here', documents)).toEqual([
      { kind: 'text', text: 'no mentions here' },
    ]);
  });

  it('finds mentions with spaces in the name', () => {
    expect(splitMentions('Go to #Castle Drakon now', documents)).toEqual([
      { kind: 'text', text: 'Go to ' },
      { kind: 'mention', text: '#Castle Drakon', document: documents[0] },
      { kind: 'text', text: ' now' },
    ]);
  });

  it('prefers the longest matching name', () => {
    const segments = splitMentions('#Romeo loves', documents);
    expect(segments[0]).toEqual({ kind: 'mention', text: '#Romeo', document: documents[4] });
  });

  it('requires a word boundary after the name', () => {
    expect(splitMentions('#Romeoland', documents)).toEqual([{ kind: 'text', text: '#Romeoland' }]);
  });

  it('allows punctuation right after the name', () => {
    const segments = splitMentions('Visit #Rome, then #count vlad.', documents);
    expect(segments.map((s) => s.kind)).toEqual(['text', 'mention', 'text', 'mention', 'text']);
    expect(segments[3]).toEqual({ kind: 'mention', text: '#count vlad', document: documents[1] });
  });

  it('ignores a # inside a word', () => {
    expect(splitMentions('x#Rome', documents)).toEqual([{ kind: 'text', text: 'x#Rome' }]);
  });

  it('leaves mentions of Documents the viewer cannot see as plain text', () => {
    expect(splitMentions('#Secret Lair', documents)).toEqual([
      { kind: 'text', text: '#Secret Lair' },
    ]);
  });

  it('handles adjacent mentions and a mention at the very end', () => {
    const segments = splitMentions('#Rome\n#Romeo', documents);
    expect(segments).toEqual([
      { kind: 'mention', text: '#Rome', document: documents[3] },
      { kind: 'text', text: '\n' },
      { kind: 'mention', text: '#Romeo', document: documents[4] },
    ]);
  });
});

describe('keyboard navigation', () => {
  const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) =>
    mentionKeyAction({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

  it('maps arrows, Enter, Tab and Escape', () => {
    expect(key('ArrowDown')).toBe('next');
    expect(key('ArrowUp')).toBe('previous');
    expect(key('Enter')).toBe('select');
    expect(key('Tab')).toBe('select');
    expect(key('Escape')).toBe('close');
    expect(key('a')).toBeNull();
  });

  it('lets modified Enter through (Ctrl+Enter submits a Comment)', () => {
    expect(key('Enter', { ctrlKey: true })).toBeNull();
    expect(key('Enter', { metaKey: true })).toBeNull();
    expect(key('Enter', { shiftKey: true })).toBeNull();
  });

  it('wraps the highlighted suggestion around', () => {
    expect(moveActiveIndex(0, 3, 1)).toBe(1);
    expect(moveActiveIndex(2, 3, 1)).toBe(0);
    expect(moveActiveIndex(0, 3, -1)).toBe(2);
    expect(moveActiveIndex(0, 0, 1)).toBe(0);
  });
});
