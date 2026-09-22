import { describe, expect, it } from 'vitest';
import {
  creatableKinds,
  documentsWithTagsHref,
  filterMentionCandidates,
  findMentionQuery,
  insertMention,
  isFinishedMention,
  mentionHref,
  mentionKeyAction,
  mentionTargetName,
  moveActiveIndex,
  newEntryName,
  normalizeForSearch,
  splitMentions,
  type MentionKeyState,
  type MentionTarget,
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

const npcTag: Tag = { id: 't-npc', name: 'NPC', category: 'Type' };
const placeTag: Tag = { id: 't-place', name: 'Place', category: 'Type' };
const tags: Tag[] = [npcTag, placeTag];

const documents = [
  doc('d-castle', 'Castle Drakon', ['t-place']),
  doc('d-count', 'Count Vlad', ['t-npc']),
  doc('d-city', 'Città Bassa', ['t-place']),
  doc('d-rome', 'Rome'),
  doc('d-romeo', 'Romeo', ['t-npc']),
];

// "D:name" for a Document, "T:name" for a Tag.
const labels = (list: MentionTarget[]) =>
  list.map((t) => `${t.kind === 'document' ? 'D' : 'T'}:${mentionTargetName(t)}`);

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

  it('allows spaces, since names can have them', () => {
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

describe('isFinishedMention', () => {
  const names = ['Castle Drakon', 'NPC'];

  it('is true for a known name followed by more prose', () => {
    expect(isFinishedMention('Castle Drakon is dark', names)).toBe(true);
    expect(isFinishedMention('npc, then', names)).toBe(true);
  });

  it('is false while the name is still being typed or extended', () => {
    expect(isFinishedMention('Castle Dra', names)).toBe(false);
    expect(isFinishedMention('Castle Drakon', names)).toBe(false);
    expect(isFinishedMention('NPCs', names)).toBe(false);
  });
});

describe('normalizeForSearch', () => {
  it('lowercases and strips accents', () => {
    expect(normalizeForSearch('Città Bassa')).toBe('citta bassa');
  });
});

describe('filterMentionCandidates', () => {
  it('lists Documents, then Tags, alphabetically for an empty query', () => {
    expect(labels(filterMentionCandidates(documents, tags, '', 20))).toEqual([
      'D:Castle Drakon',
      'D:Città Bassa',
      'D:Count Vlad',
      'D:Rome',
      'D:Romeo',
      'T:NPC',
      'T:Place',
    ]);
  });

  it('matches names ignoring case and accents', () => {
    expect(labels(filterMentionCandidates(documents, tags, 'citta'))).toEqual(['D:Città Bassa']);
  });

  it('ranks name prefixes before word and substring matches', () => {
    const extra = [...documents, doc('d-ruins', 'Old Drakon Ruins'), doc('d-sub', 'Undrakonian')];
    expect(labels(filterMentionCandidates(extra, tags, 'drak'))).toEqual([
      'D:Castle Drakon',
      'D:Old Drakon Ruins',
      'D:Undrakonian',
    ]);
  });

  it('offers the Tag itself, then the Documents that carry it', () => {
    expect(labels(filterMentionCandidates(documents, tags, 'npc'))).toEqual([
      'T:NPC',
      'D:Count Vlad',
      'D:Romeo',
    ]);
  });

  it('puts a Document before a Tag that matches as well', () => {
    const extra = [...documents, doc('d-npc', 'Npc Registry')];
    expect(labels(filterMentionCandidates(extra, tags, 'npc')).slice(0, 2)).toEqual([
      'D:Npc Registry',
      'T:NPC',
    ]);
  });

  it('counts the visible Documents carrying each Tag', () => {
    const [place] = filterMentionCandidates(documents, tags, 'place');
    expect(place).toEqual({ kind: 'tag', tag: placeTag, documentCount: 2 });
  });

  it('returns each Document with its Tags, ignoring unknown Tag ids', () => {
    const [castle] = filterMentionCandidates(documents, tags, 'castle');
    expect(castle.kind === 'document' && castle.tags).toEqual([placeTag]);
    const [ghost] = filterMentionCandidates([doc('d-ghost', 'Ghost', ['t-gone'])], [], '');
    expect(ghost.kind === 'document' && ghost.tags).toEqual([]);
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
    expect(insertMention('Meet #cou', { start: 5, query: 'cou' }, 9, 'Count Vlad')).toEqual({
      text: 'Meet #Count Vlad ',
      caret: 17,
    });
  });

  it('keeps the text after the caret and adds no double space', () => {
    expect(insertMention('Meet #cou tonight', { start: 5, query: 'cou' }, 9, 'Count Vlad')).toEqual({
      text: 'Meet #Count Vlad tonight',
      caret: 16,
    });
  });
});

describe('splitMentions', () => {
  it('returns plain text when nothing is mentioned', () => {
    expect(splitMentions('no mentions here', documents, tags)).toEqual([
      { kind: 'text', text: 'no mentions here' },
    ]);
  });

  it('finds Document mentions with spaces in the name', () => {
    expect(splitMentions('Go to #Castle Drakon now', documents, tags)).toEqual([
      { kind: 'text', text: 'Go to ' },
      { kind: 'document', text: '#Castle Drakon', document: documents[0] },
      { kind: 'text', text: ' now' },
    ]);
  });

  it('finds Tag mentions', () => {
    expect(splitMentions('All the #npc here', documents, tags)).toEqual([
      { kind: 'text', text: 'All the ' },
      { kind: 'tag', text: '#npc', tag: npcTag },
      { kind: 'text', text: ' here' },
    ]);
  });

  it('prefers a Document over a Tag with the same name', () => {
    const [segment] = splitMentions('#NPC', [doc('d-npc', 'NPC')], tags);
    expect(segment.kind).toBe('document');
  });

  it('prefers the longest matching name', () => {
    const [segment] = splitMentions('#Romeo loves', documents, tags);
    expect(segment).toEqual({ kind: 'document', text: '#Romeo', document: documents[4] });
  });

  it('requires a word boundary after the name', () => {
    expect(splitMentions('#Romeoland #NPCs', documents, tags)).toEqual([
      { kind: 'text', text: '#Romeoland #NPCs' },
    ]);
  });

  it('allows punctuation right after the name', () => {
    const segments = splitMentions('Visit #Rome, then #count vlad.', documents, tags);
    expect(segments.map((s) => s.kind)).toEqual(['text', 'document', 'text', 'document', 'text']);
  });

  it('ignores a # inside a word', () => {
    expect(splitMentions('x#Rome', documents, tags)).toEqual([{ kind: 'text', text: 'x#Rome' }]);
  });

  it('leaves mentions of Documents the viewer cannot see as plain text', () => {
    expect(splitMentions('#Secret Lair', documents, tags)).toEqual([
      { kind: 'text', text: '#Secret Lair' },
    ]);
  });

  it('handles adjacent mentions and a mention at the very end', () => {
    expect(splitMentions('#Rome\n#Place', documents, tags)).toEqual([
      { kind: 'document', text: '#Rome', document: documents[3] },
      { kind: 'text', text: '\n' },
      { kind: 'tag', text: '#Place', tag: placeTag },
    ]);
  });
});

describe('links', () => {
  it('points a Document mention at the Document', () => {
    expect(mentionHref('r1', { kind: 'document', text: '#Rome', document: documents[3] })).toBe(
      '/rooms/r1/documents/d-rome',
    );
  });

  it('points a Tag mention at the Documents list filtered by it', () => {
    expect(mentionHref('r1', { kind: 'tag', text: '#NPC', tag: npcTag })).toBe(
      '/rooms/r1/documents?tag=t-npc',
    );
  });

  it('builds a list link for several Tags, or none', () => {
    expect(documentsWithTagsHref('r1', ['a', 'b'])).toBe('/rooms/r1/documents?tag=a&tag=b');
    expect(documentsWithTagsHref('r1', [])).toBe('/rooms/r1/documents');
  });
});

describe('creating from the popup', () => {
  it('offers only what the viewer may create, Document first', () => {
    expect(creatableKinds({ canCreateDocument: true, canCreateTag: true })).toEqual(['document', 'tag']);
    expect(creatableKinds({ canCreateDocument: false, canCreateTag: true })).toEqual(['tag']);
    expect(creatableKinds({ canCreateDocument: false, canCreateTag: false })).toEqual([]);
  });

  it('cleans up the typed name', () => {
    expect(newEntryName('  Old   Mill ')).toBe('Old Mill');
    expect(newEntryName('   ')).toBe('');
  });
});

describe('mentionKeyAction', () => {
  const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });
  const list: MentionKeyState = { candidateCount: 3, createAvailable: false, createHighlighted: false };
  const create: MentionKeyState = { candidateCount: 0, createAvailable: true, createHighlighted: false };
  const onCreate: MentionKeyState = { ...create, createHighlighted: true };
  const empty: MentionKeyState = { candidateCount: 0, createAvailable: false, createHighlighted: false };

  it('navigates and picks from the list', () => {
    expect(mentionKeyAction(key('ArrowDown'), list)).toBe('next');
    expect(mentionKeyAction(key('ArrowUp'), list)).toBe('previous');
    expect(mentionKeyAction(key('Enter'), list)).toBe('select');
    expect(mentionKeyAction(key('Tab'), list)).toBe('select');
    expect(mentionKeyAction(key('Escape'), list)).toBe('close');
    expect(mentionKeyAction(key('a'), list)).toBeNull();
  });

  it('lets modified Enter through (Ctrl+Enter submits a Comment)', () => {
    expect(mentionKeyAction(key('Enter', { ctrlKey: true }), list)).toBeNull();
    expect(mentionKeyAction(key('Enter', { metaKey: true }), list)).toBeNull();
    expect(mentionKeyAction(key('Enter', { shiftKey: true }), list)).toBeNull();
  });

  it('never creates on a plain Enter: the row must be reached first', () => {
    expect(mentionKeyAction(key('Enter'), create)).toBeNull();
    expect(mentionKeyAction(key('ArrowLeft'), create)).toBeNull();
    expect(mentionKeyAction(key('ArrowDown'), create)).toBe('highlightCreate');
  });

  it('switches the kind and creates from the highlighted row', () => {
    expect(mentionKeyAction(key('ArrowRight'), onCreate)).toBe('toggleKind');
    expect(mentionKeyAction(key('ArrowLeft'), onCreate)).toBe('toggleKind');
    expect(mentionKeyAction(key('Enter'), onCreate)).toBe('create');
    expect(mentionKeyAction(key('Tab'), onCreate)).toBe('create');
    expect(mentionKeyAction(key('ArrowUp'), onCreate)).toBe('unhighlightCreate');
    expect(mentionKeyAction(key('Enter', { ctrlKey: true }), onCreate)).toBeNull();
  });

  it('only closes when there is nothing to pick or create', () => {
    expect(mentionKeyAction(key('Enter'), empty)).toBeNull();
    expect(mentionKeyAction(key('ArrowDown'), empty)).toBeNull();
    expect(mentionKeyAction(key('Escape'), empty)).toBe('close');
  });
});

describe('moveActiveIndex', () => {
  it('wraps the highlighted suggestion around', () => {
    expect(moveActiveIndex(0, 3, 1)).toBe(1);
    expect(moveActiveIndex(2, 3, 1)).toBe(0);
    expect(moveActiveIndex(0, 3, -1)).toBe(2);
    expect(moveActiveIndex(0, 0, 1)).toBe(0);
  });
});
