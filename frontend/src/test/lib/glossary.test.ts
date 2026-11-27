import { describe, expect, it } from 'vitest';
import {
  filterGlossary,
  glossaryFormValues,
  glossaryLetter,
  groupByLetter,
  splitGlossaryTerms,
  termKey,
  toGlossaryBody,
} from '../../lib/glossary';
import type { GlossaryEntry } from '../../types/glossary';

function entry(over: Partial<GlossaryEntry> & { id: string; term: string }): GlossaryEntry {
  return {
    aliases: [],
    definition: '',
    visibility: 'room',
    selectiveUserIds: [],
    highlight: true,
    tagIds: [],
    documents: [],
    createdAt: '',
    updatedAt: '',
    canEdit: false,
    canDelete: false,
    ...over,
  };
}

const mist = entry({ id: 'mist', term: 'Mist', aliases: ['The Fog'] });
const strahd = entry({ id: 'strahd', term: 'Strahd von Zarovich', aliases: ['Strahd'] });

describe('termKey', () => {
  it('ignores case, accents and spacing', () => {
    expect(termKey('  Bärovia   MIST ')).toBe('barovia mist');
  });
});

describe('splitGlossaryTerms', () => {
  it('finds whole words, ignoring case and accents, and keeps the written text', () => {
    const runs = splitGlossaryTerms('Beware the mist, and the THE FOG.', [mist], false);
    expect(runs.filter((run) => run.kind === 'glossary').map((run) => run.text)).toEqual([
      'mist',
      'THE FOG',
    ]);
    expect(runs.map((run) => run.text).join('')).toBe('Beware the mist, and the THE FOG.');
  });

  it('does not match inside another word or after a mention sign', () => {
    const runs = splitGlossaryTerms('Mistral and #Mist and @Mist and Mist.', [mist], false);
    expect(runs.filter((run) => run.kind === 'glossary')).toHaveLength(1);
  });

  it('highlights only the first occurrence of each entry across one text', () => {
    const used = new Set<string>();
    const first = splitGlossaryTerms('Mist, then mist.', [mist], true, used);
    const second = splitGlossaryTerms('More mist.', [mist], true, used);
    expect(first.filter((run) => run.kind === 'glossary')).toHaveLength(1);
    expect(second.filter((run) => run.kind === 'glossary')).toHaveLength(0);
  });

  it('prefers the longest word where two overlap', () => {
    const runs = splitGlossaryTerms('Strahd von Zarovich rules.', [strahd], false);
    expect(runs.find((run) => run.kind === 'glossary')?.text).toBe('Strahd von Zarovich');
  });

  it('skips entries that opt out', () => {
    const quiet = entry({ id: 'q', term: 'Mist', highlight: false });
    expect(splitGlossaryTerms('Mist.', [quiet])).toEqual([{ kind: 'text', text: 'Mist.' }]);
  });

  it('keeps offsets right when an accent decomposes', () => {
    const cafe = entry({ id: 'c', term: 'Cafe' });
    const runs = splitGlossaryTerms('Un café ok', [cafe], false);
    expect(runs.map((run) => run.text)).toEqual(['Un ', 'café', ' ok']);
  });
});

describe('listing', () => {
  const entries = [mist, strahd, entry({ id: 'a', term: 'Àlpha', tagIds: ['t1'] }), entry({ id: 'n', term: '3 coins' })];

  it('files a term under its first letter without accents, symbols first', () => {
    expect(glossaryLetter('Àlpha')).toBe('A');
    expect(glossaryLetter('3 coins')).toBe('#');
    expect(groupByLetter(entries).map((group) => group.letter)).toEqual(['#', 'A', 'M', 'S']);
  });

  it('filters by typed word on terms and aliases, and by every picked Tag', () => {
    expect(filterGlossary(entries, 'fog', []).map((e) => e.id)).toEqual(['mist']);
    expect(filterGlossary(entries, '', ['t1']).map((e) => e.id)).toEqual(['a']);
    expect(filterGlossary(entries, '', ['t1', 't2'])).toEqual([]);
  });
});

describe('glossaryFormValues', () => {
  it('turns an entry into the form values, linked Documents as ids', () => {
    const linked = entry({
      id: 'g',
      term: 'Mist',
      aliases: ['Fog'],
      tagIds: ['t1'],
      documents: [{ id: 'd1', name: 'Castle' }],
    });
    expect(glossaryFormValues(linked)).toMatchObject({
      term: 'Mist',
      aliases: ['Fog'],
      tagIds: ['t1'],
      documentIds: ['d1'],
      visibility: 'room',
      highlight: true,
    });
  });
});

describe('smaller cases', () => {
  it('ignores a word with no letters and finds a term that ends the text', () => {
    const runs = splitGlossaryTerms('the mist', [entry({ id: 'x', term: ' ' }), mist]);
    expect(runs.map((run) => run.text)).toEqual(['the ', 'mist']);
  });

  it('puts terms that start with no letter first, under #', () => {
    const groups = groupByLetter([mist, entry({ id: 'n', term: '9 Lives' })]);
    expect(groups.map((group) => group.letter)).toEqual(['#', 'M']);
  });

  it('keeps Selective grants in the body only for a Selective entry', () => {
    const values = { ...glossaryFormValues(mist), selectiveUserIds: ['u2'] };
    expect(toGlossaryBody({ ...values, visibility: 'selective' }).selective_user_ids).toEqual(['u2']);
    expect(toGlossaryBody({ ...values, visibility: 'room' }).selective_user_ids).toEqual([]);
  });
});
