import { describe, expect, it } from 'vitest';
import {
  blockHeading,
  defaultBlockHeading,
  featureLabel,
  groupLabel,
  linesVeilsLine,
  pageName,
  pollLine,
  sectionDescription,
  sectionName,
  sectionTitle,
  sessionLine,
  stepLine,
  stepTitle,
  tagsOf,
} from '../../lib/landingText';
import type { DdiStep, OverviewStep, Poll } from '../../types/sessionZero';
import { block, overview, tag } from '../landingFixtures';

const tags = [tag('t1', 'Tokyo'), tag('t2', 'PNG')];
const [round] = overview().rounds;
const [retro, questions, ddiStep, pollStep] = round.steps;
const poll = pollStep.polls![0];

describe('the landing texts', () => {
  it('names the cards', () => {
    expect(pageName('page_maps')).toBe('Mappe');
    expect(sectionTitle({ kind: 'page_session_zero', title: null })).toBe('Sessione 0');
    expect(sectionTitle({ kind: 'page_documents', title: 'Archivio' })).toBe('Archivio');
    expect(sectionTitle({ kind: 'custom', title: null })).toBe('');
    expect(sectionName({ kind: 'custom', title: null })).toBe('Sezione senza titolo');
    expect(sectionName({ kind: 'page_maps', title: null })).toBe('Mappe');
    expect(sectionDescription({ kind: 'page_documents', description: '' })).toBe('Tutti i Documenti della Stanza');
    expect(sectionDescription({ kind: 'page_documents', description: 'Mia' })).toBe('Mia');
    expect(sectionDescription({ kind: 'custom', description: '' })).toBe('');
  });

  it('names the blocks after their source', () => {
    expect(featureLabel('ddi')).toBe('DDI');
    expect(tagsOf(['t2', 'gone', 't1'], tags).map((t) => t.name)).toEqual(['PNG', 'Tokyo']);
    expect(defaultBlockHeading(block({ tag_ids: ['t1', 't2'] }), tags)).toBe('Documenti · #Tokyo, #PNG');
    expect(defaultBlockHeading(block({ kind: 'maps', tag_ids: [] }), tags)).toBe('Mappe');
    expect(defaultBlockHeading(block({ kind: 'maps', tag_ids: [], map_kind: 'free' }), tags)).toBe('Mappe delle relazioni');
    expect(defaultBlockHeading(block({ kind: 'maps', tag_ids: [], map_kind: 'geographic' }), tags)).toBe('Mappe geografiche');
    expect(defaultBlockHeading(block({ kind: 'session_zero', tag_ids: [], features: ['polls'] }), tags)).toBe('Sondaggi');
    expect(defaultBlockHeading(block({ kind: 'session_zero', tag_ids: [], features: ['polls', 'ddi'] }), tags)).toBe('Sessione 0');
    expect(blockHeading(block({ heading: 'Mio' }), tags)).toBe('Mio');
    expect(blockHeading(block({ tag_ids: ['t1'] }), tags)).toBe('Documenti · #Tokyo');
    expect(groupLabel(['t1', 't2'], tags)).toBe('#Tokyo + #PNG');
  });

  it('describes a session and its steps', () => {
    expect(sessionLine(round.startedAt, round.steps)).toMatch(/^27 ott · Retro, Domande, DDI, Sondaggio$/);
    expect(sessionLine(round.startedAt, [])).toBe('27 ott');
    expect(stepTitle(retro, round)).toBe('Retro · Sessione 0');
    expect(stepLine(retro, false)).toBe('2 post-it');
    expect(stepLine(questions, false)).toBe('1 domanda');
    expect(stepLine({ ...questions, questions: undefined } as OverviewStep, false)).toBe('0 domande');
    expect(stepLine({ ...ddiStep, ddi: undefined } as OverviewStep, false)).toBe('');
  });

  it('says where a DDI stands for the Master and for a Player', () => {
    const ddi = (acceptances: DdiStep['acceptances'], documentId: string | null = 'doc-1') =>
      ({ ...ddiStep, ddi: { ...ddiStep.ddi!, documentId, acceptances } }) as OverviewStep;
    const accepted = { userId: 'u', acceptedAt: 'x', outdated: false, mine: true };
    expect(stepLine(ddi([], null), true)).toBe('');
    expect(stepLine(ddi([accepted, { ...accepted, outdated: true }]), true)).toBe('Accettata da 1 giocatore');
    expect(stepLine(ddi([accepted]), false)).toBe('Accettata da te');
    expect(stepLine(ddi([{ ...accepted, mine: false }]), false)).toBe('Da accettare');
  });

  it('describes a poll and Lines & Veils', () => {
    expect(pollLine(poll)).toBe('Aperto · 1 su 3 hanno votato');
    expect(pollLine({ ...poll, closed: true } as Poll)).toBe('Chiuso');
    const won = { ...poll, closed: true, options: poll.options.map((option) => ({ ...option, winner: true })) } as Poll;
    expect(pollLine(won)).toBe('Chiuso · vince D&D, PbtA');
    expect(linesVeilsLine({ must: 1, veils: 2 })).toBe('Linee 0 · Veli 2 · Must 1');
  });
});
