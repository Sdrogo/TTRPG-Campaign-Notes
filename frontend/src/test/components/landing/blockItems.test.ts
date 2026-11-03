import { describe, expect, it } from 'vitest';
import { blockContent, isBlockEmpty } from '../../../components/landing/blockItems';
import { block, doc, map, overview, tag } from '../../landingFixtures';

const tags = [tag('t1', 'Tokyo'), tag('t2', 'PNG'), tag('t3', 'Yakuza')];
const documents = [doc('a', 'Aiko', ['t1', 't2']), doc('b', 'Bunta', ['t1', 't3']), doc('c', 'Chie', ['t1'])];

describe('a block content', () => {
  it('waits for what it reads', () => {
    expect(blockContent(block(), { tags })).toBeUndefined();
    expect(blockContent(block({ kind: 'maps', tag_ids: [] }), { tags })).toBeUndefined();
    expect(blockContent(block({ kind: 'session_zero', tag_ids: [], features: ['sessions'] }), { tags })).toBeUndefined();
    expect(isBlockEmpty(undefined)).toBe(false);
  });

  it('leaves a Clocks block to its own component, never empty', () => {
    const content = blockContent(block({ kind: 'clocks', tag_ids: [] }), { tags });
    expect(content).toEqual({ kind: 'clocks' });
    expect(isBlockEmpty(content)).toBe(false);
  });

  it('lists a Documents block without groups under no heading', () => {
    const content = blockContent(block({ tag_ids: ['t1'] }), { documents, tags });
    expect(content).toEqual({ kind: 'documents', parts: [{ key: 'all', label: null, documents: [documents[0], documents[1], documents[2]] }] });
    expect(isBlockEmpty(content)).toBe(false);
    const none = blockContent(block({ tag_ids: ['t2', 't3'] }), { documents, tags });
    expect(none).toEqual({ kind: 'documents', parts: [] });
    expect(isBlockEmpty(none)).toBe(true);
  });

  it('splits a Documents block into its groups, the rest last', () => {
    const content = blockContent(block({ tag_ids: ['t1'], groups: [['t2'], ['t3', 't1']] }), { documents, tags });
    expect(content?.kind === 'documents' && content.parts.map((part) => [part.key, part.label, part.documents.map((d) => d.id)])).toEqual([
      ['t2', '#PNG', ['a']],
      ['t3+t1', '#Yakuza + #Tokyo', ['b']],
      ['ungrouped', 'Altri documenti', ['c']],
    ]);
  });

  it('shows a tool block only when the viewer gets its tool (spec 60)', () => {
    const tool = block({ kind: 'tool', tag_ids: [], module_id: 'm-1', tool_kind: 'poll' });
    expect(blockContent(tool, { tags })).toBeUndefined();
    const module = { id: 'm-1', kind: 'poll' as const, position: 0, columns: [] };
    const shown = blockContent(tool, { tags, tools: { revision: 1, tools: [{ moduleId: 'm-1', playersVisible: true, module }] } });
    expect(shown).toEqual({ kind: 'tool', shown: true });
    expect(isBlockEmpty(shown)).toBe(false);
    const hidden = blockContent(tool, { tags, tools: { revision: 1, tools: [] } });
    expect(isBlockEmpty(hidden)).toBe(true);
  });

  it('lists a maps block', () => {
    const content = blockContent(block({ kind: 'maps', tag_ids: [], map_kind: 'geographic' }), { maps: [map()], tags });
    expect(content).toEqual({ kind: 'maps', maps: [] });
    expect(isBlockEmpty(content)).toBe(true);
  });

  it('lists a Session 0 block by feature, headed only when several', () => {
    const one = blockContent(block({ kind: 'session_zero', tag_ids: [], features: ['polls'] }), { overview: overview(), tags });
    expect(one?.kind === 'session_zero' && one.parts.map((part) => [part.key, part.label, part.items.length])).toEqual([['polls', null, 1]]);
    const several = blockContent(block({ kind: 'session_zero', tag_ids: [], features: ['retro', 'stars_wishes', 'ddi'] }), {
      overview: overview(),
      tags,
    });
    expect(several?.kind === 'session_zero' && several.parts.map((part) => [part.key, part.label])).toEqual([
      ['retro', 'Retro'],
      ['ddi', 'DDI'],
    ]);
    expect(isBlockEmpty(several)).toBe(false);
  });
});
