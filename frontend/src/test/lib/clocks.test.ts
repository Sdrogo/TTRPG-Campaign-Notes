import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_TEMPLATES,
  blockClocks,
  builtInSettings,
  canCreateClocks,
  clockSummary,
  emptySettings,
  groupClocks,
  groupPrompt,
  groupResultLine,
  historyLine,
  isMarkable,
  isUnmarkable,
  matchingPreset,
  splitClocks,
  stateLabel,
  templateSettings,
  toClock,
  toCreateBody,
  toGroup,
  toHistory,
  toLabel,
  toRules,
  toSettingsBody,
  toUpdateBody,
  usableKinds,
  wedgeColors,
  wedgeDelta,
  wedgePath,
} from '../../lib/clocks';
import type { ClockFormValues, ClockHistoryEntry, MarkKind } from '../../types/clock';
import type { Member } from '../../types/member';
import { rawClock, rawGroup, rawRules } from '../clockFixtures';

const rules = toRules(rawRules());
const kinds = rules.markKinds;
const clock = (overrides: Parameters<typeof rawClock>[0] = {}) => toClock(rawClock(overrides));

function form(overrides: Partial<ClockFormValues> = {}): ClockFormValues {
  return {
    ...emptySettings(),
    name: '  Allarme ',
    documentId: null,
    visibility: 'room',
    selectiveUserIds: ['user-2'],
    ...overrides,
  };
}

describe('from the wire', () => {
  it('maps the rules, a clock and a group to camelCase', () => {
    expect(rules.openPolicy).toBe('master');
    expect(rules.labels[0]).toEqual({ id: 'label-1', name: 'Jazz', color: 'violet', position: 0, clockCount: 2 });
    expect(rules.templates[0].settings.labelIds).toEqual(['label-1', 'label-gone']);
    expect(clock().canUnmark).toBe(true);
    expect(clock().segmentKinds).toHaveLength(4);
    expect(toGroup(rawGroup()).clockIds).toEqual(['clock-1']);
  });

  it("leaves a label's count out for a Player", () => {
    expect(toLabel({ id: 'l', name: 'Rock', color: 'red', position: 1 }).clockCount).toBeNull();
  });

  it('maps a page of history', () => {
    const page = toHistory({
      entries: [{ id: 'e', user_id: null, action: 'closed', details: {}, created_at: 'now' }],
      next_before: 'cursor',
    });
    expect(page).toEqual({
      entries: [{ id: 'e', userId: null, action: 'closed', details: {}, createdAt: 'now' }],
      nextBefore: 'cursor',
    });
  });
});

describe('to the wire', () => {
  it('drops trailing empty stages and those past the size, and sends empty texts as null', () => {
    const body = toSettingsBody({
      ...emptySettings(),
      segments: 2,
      stageLabels: ['a', 'b', 'c', ' ', ''],
      closingCondition: '  ',
      consequence: ' Boom ',
    });
    expect(body.stage_labels).toEqual(['a', 'b']);
    expect(body.closing_condition).toBeNull();
    expect(body.consequence).toBe('Boom');
  });

  it('sends grants only for a Selective clock', () => {
    expect(toCreateBody(form()).selective_user_ids).toEqual([]);
    const selective = toCreateBody(form({ visibility: 'selective', documentId: 'doc-1' }));
    expect(selective).toMatchObject({ name: 'Allarme', selective_user_ids: ['user-2'], document_id: 'doc-1' });
  });

  it('clears the nullable fields an edit emptied, with the revision it was loaded at (spec 42)', () => {
    const body = toUpdateBody(form(), 7);
    expect(body).toMatchObject({ base_revision: 7, name: 'Allarme', selective_user_ids: [] });
    expect(body.clear).toEqual(['closing_condition', 'consequence', 'mark_policy', 'document_id']);
    const full = toUpdateBody(
      form({
        closingCondition: 'Jazz',
        consequence: 'Boom',
        markPolicy: 'everyone',
        documentId: 'doc-1',
        visibility: 'selective',
      }),
      7,
    );
    expect(full).toMatchObject({
      closing_condition: 'Jazz',
      consequence: 'Boom',
      mark_policy: 'everyone',
      document_id: 'doc-1',
      selective_user_ids: ['user-2'],
      clear: [],
    });
  });
});

describe('templates and presets', () => {
  it("numbers a countdown's stages and keeps the others bare (Decision 3)", () => {
    const countdown = BUILT_IN_TEMPLATES.find((t) => t.key === 'countdown')!;
    expect(builtInSettings(countdown).stageLabels).toEqual(['Tappa 1', 'Tappa 2', 'Tappa 3', 'Tappa 4', 'Tappa 5', 'Tappa 6']);
    expect(builtInSettings(BUILT_IN_TEMPLATES[0])).toMatchObject({ segments: 6, color: 'green', stageLabels: [] });
  });

  it("drops a Room template's labels the Room has since deleted", () => {
    expect(templateSettings(rules.templates[0], rules.labels).labelIds).toEqual(['label-1']);
  });

  it('finds the preset the policies match, or none', () => {
    expect(matchingPreset({ openPolicy: 'master', markPolicy: 'master', allowUnmark: true })?.key).toBe('simple');
    expect(matchingPreset({ openPolicy: 'master', markPolicy: 'everyone', allowUnmark: true })).toBeNull();
  });
});

describe('who may do what', () => {
  it("offers the kinds a member may use (Decision 1)", () => {
    const everyone: MarkKind = { id: 'k3', name: 'Tutti', color: 'gold', who: 'everyone', position: 2 };
    const all = [...kinds, everyone];
    expect(usableKinds(all, true).map((k) => k.id)).toEqual(['kind-2', 'k3']);
    expect(usableKinds(all, false).map((k) => k.id)).toEqual(['kind-1', 'k3']);
  });

  it('lets Players open clocks only when the rules and the Room allow it (D-13)', () => {
    expect(canCreateClocks({ openPolicy: 'master' }, true, false)).toBe(true);
    expect(canCreateClocks({ openPolicy: 'master' }, false, true)).toBe(false);
    expect(canCreateClocks({ openPolicy: 'propose' }, false, true)).toBe(true);
    expect(canCreateClocks({ openPolicy: 'everyone' }, false, false)).toBe(false);
  });

  it('takes marks only on an open clock, not archived nor waiting its turn', () => {
    expect(isMarkable(clock())).toBe(true);
    expect(isMarkable(clock({ can_mark: false }))).toBe(false);
    expect(isMarkable(clock({ state: 'closed' }))).toBe(false);
    expect(isMarkable(clock({ archived: true }))).toBe(false);
    expect(isMarkable(clock({ locked: true }))).toBe(false);
  });

  it('empties an open or closed clock with marks (a closed one reopens, Decision 5)', () => {
    expect(isUnmarkable(clock({ state: 'closed' }))).toBe(true);
    expect(isUnmarkable(clock({ can_unmark: false }))).toBe(false);
    expect(isUnmarkable(clock({ filled: 0 }))).toBe(false);
    expect(isUnmarkable(clock({ state: 'lapsed' }))).toBe(false);
    expect(isUnmarkable(clock({ archived: true }))).toBe(false);
    expect(isUnmarkable(clock({ locked: true }))).toBe(false);
  });

  it('reads a wedge click as fill up to it or empty the last one (Decision 7)', () => {
    expect(wedgeDelta(clock(), 6)).toBe(3);
    expect(wedgeDelta(clock(), 3)).toBe(-1);
    expect(wedgeDelta(clock(), 1)).toBe(-2);
    expect(wedgeDelta(clock({ can_mark: false }), 6)).toBe(0);
    expect(wedgeDelta(clock({ can_unmark: false }), 3)).toBe(0);
    expect(wedgeDelta(clock({ can_unmark: false }), 1)).toBe(0);
  });
});

describe('reading clocks', () => {
  it('names the state, archived and waiting first', () => {
    expect(stateLabel(clock())).toBe('Aperto');
    expect(stateLabel(clock({ archived: true }))).toBe('Archiviato');
    expect(stateLabel(clock({ locked: true }))).toBe('Bloccato');
    expect(stateLabel(clock({ locked: true, state: 'closed' }))).toBe('Chiuso');
  });

  it('says how many marks of each kind a face shows', () => {
    expect(clockSummary(clock(), kinds)).toBe('Allarme: 4 su 8, Aperto');
    const mixed = clock({ segment_kinds: ['kind-1', 'kind-1', 'kind-2', null] });
    expect(clockSummary(mixed, kinds)).toBe('Allarme: 4 su 8, Aperto, 2 Successo, 1 Shock');
  });

  it('splits the page into open, proposed, finished and archived clocks (Decision 17)', () => {
    const lists = splitClocks([
      clock({ id: 'a' }),
      clock({ id: 'b', state: 'proposed' }),
      clock({ id: 'c', state: 'closed' }),
      clock({ id: 'd', state: 'lapsed' }),
      clock({ id: 'e', archived: true }),
    ]);
    expect(lists.open.map((c) => c.id)).toEqual(['a']);
    expect(lists.proposed.map((c) => c.id)).toEqual(['b']);
    expect(lists.finished.map((c) => c.id)).toEqual(['c', 'd']);
    expect(lists.archived.map((c) => c.id)).toEqual(['e']);
  });

  it('draws wedges clockwise from twelve, a half circle with the large arc', () => {
    expect(wedgePath(0, 4, 10)).toBe('M 10 10 L 10.000 0.000 A 10 10 0 0 1 20.000 10.000 Z');
    expect(wedgePath(0, 2, 10)).toContain(' 0 0 1 ');
    expect(wedgePath(0, 1, 10)).toContain(' 0 1 1 ');
  });

  it("colours a wedge by its mark kind, else the clock's, a lost kind grey", () => {
    const mixed = clock({ segment_kinds: ['kind-1', null, 'gone', 'kind-2'] });
    expect(wedgeColors(mixed, kinds)).toEqual(['green', 'red', 'silver', 'red']);
  });
});

describe('history lines (Decision 10)', () => {
  const members = [{ userId: 'user-1', displayName: 'Marco', role: 'player', isAdmin: false } as Member];
  const entry = (overrides: Partial<ClockHistoryEntry>): ClockHistoryEntry => ({
    id: 'e',
    userId: 'user-1',
    action: 'marked',
    details: {},
    createdAt: 'now',
    ...overrides,
  });

  it('reads a mark with its kind, where the clock stood and the note', () => {
    const line = historyLine(
      entry({ details: { delta: 2, kind_id: 'kind-1', filled: 4, segments: 8, note: 'forzata la serratura' } }),
      kinds,
      members,
    );
    expect(line).toBe('Marco · Successo +2 · 4/8 · forzata la serratura');
  });

  it('reads a plain mark, an undo and a former member', () => {
    expect(historyLine(entry({ details: { delta: -1 } }), kinds, members)).toBe('Marco · -1');
    expect(historyLine(entry({ details: {} }), kinds, members)).toBe('Marco · 0');
    expect(historyLine(entry({ userId: 'gone', action: 'undone', details: { delta: 1, filled: 3, segments: 8 } }), kinds, members)).toBe(
      'Ex membro · annullato +1 · 3/8',
    );
  });

  it('names the edited fields, and the other actions', () => {
    expect(historyLine(entry({ action: 'edited', details: { fields: ['name', 'segments'] } }), kinds, members)).toBe(
      'Marco · ha modificato: nome, calibro',
    );
    expect(historyLine(entry({ action: 'edited', details: {} }), kinds, members)).toBe('Marco · ha modificato: ');
    expect(historyLine(entry({ action: 'closed' }), kinds, members)).toBe('Marco · chiuso');
  });
});

describe('groups (Decisions 11-12)', () => {
  const group = (overrides: Parameters<typeof rawGroup>[0] = {}) => toGroup(rawGroup(overrides));
  const fuga = clock({ id: 'a', name: 'Fuga' });
  const accerchiati = clock({ id: 'b', name: 'Accerchiati' });

  it('reads a race or a turn result, and none', () => {
    expect(group({ result: { winner_ids: ['a'], tie: false } }).result).toEqual({ kind: 'race', winnerIds: ['a'], tie: false });
    expect(group({ result: { outcomes: [{ clock_id: 'a', label: 'Vinta' }] } }).result).toEqual({
      kind: 'turn',
      outcomes: [{ clockId: 'a', label: 'Vinta' }],
    });
    expect(group({ result: {} }).result).toEqual({ kind: 'turn', outcomes: [] });
    expect(group().result).toBeNull();
  });

  it("lists a group's clocks the viewer sees, in order, archived ones out", () => {
    const archived = clock({ id: 'c', archived: true });
    expect(groupClocks(group({ clock_ids: ['b', 'gone', 'c', 'a'] }), [fuga, accerchiati, archived]).map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('says how an ended group came out', () => {
    const clocks = [fuga, accerchiati];
    expect(groupResultLine(null, clocks)).toBeNull();
    expect(groupResultLine({ kind: 'race', winnerIds: ['a'], tie: false }, clocks)).toBe('Vinto: «Fuga»');
    expect(groupResultLine({ kind: 'race', winnerIds: ['a', 'b'], tie: true }, clocks)).toBe('Pari: «Fuga», «Accerchiati»');
    expect(
      groupResultLine({ kind: 'turn', outcomes: [{ clockId: 'a', label: 'Fuori!' }, { clockId: 'b', label: null }] }, clocks),
    ).toBe('Svolta: Fuori!, «Accerchiati»');
  });

  it("asks the Master to confirm a race or end a turn, not once it ended nor for a free group", () => {
    const clocks = [clock({ id: 'a', state: 'closed' }), accerchiati];
    expect(groupPrompt(group({ pending_ids: ['a'] }), clocks)).toEqual({ kind: 'race', clocks: [clocks[0]] });
    expect(groupPrompt(group({ mode: 'turn', pending_ids: ['a'] }), clocks)?.kind).toBe('turn');
    expect(groupPrompt(group({ pending_ids: [] }), clocks)).toBeNull();
    expect(groupPrompt(group({ pending_ids: ['a'], ended: true }), clocks)).toBeNull();
    expect(groupPrompt(group({ mode: 'free', pending_ids: ['a'] }), clocks)).toBeNull();
  });

  it("offers to reveal a sequence's next clock once the one before it closed, if it is hidden", () => {
    const sequence = group({ mode: 'sequence', clock_ids: ['a', 'b'] });
    const hidden = clock({ id: 'b', visibility: 'master' });
    expect(groupPrompt(sequence, [clock({ id: 'a', state: 'closed' }), hidden])).toEqual({ kind: 'reveal', clock: hidden });
    expect(groupPrompt(sequence, [clock({ id: 'a', state: 'lapsed' }), hidden])).toBeNull();
    expect(groupPrompt(sequence, [clock({ id: 'a', state: 'closed' }), clock({ id: 'b' })])).toBeNull();
    expect(groupPrompt(sequence, [clock({ id: 'a' }), hidden])).toBeNull();
    expect(groupPrompt(sequence, [clock({ id: 'a', state: 'closed' }), clock({ id: 'b', state: 'closed' })])).toBeNull();
  });
});

describe('Clocks blocks (Decision 18)', () => {
  const clocks = [
    clock({ id: 'a' }),
    clock({ id: 'b', state: 'closed' }),
    clock({ id: 'c', archived: true }),
    clock({ id: 'd', state: 'proposed' }),
  ];
  const groups = [toGroup(rawGroup({ id: 'g', clock_ids: ['b', 'a'] }))];

  it('shows every open clock with "Tutti i clock aperti"', () => {
    expect(blockClocks({ allClocks: true, clockChips: [] }, clocks, groups).map((c) => c.id)).toEqual(['a']);
  });

  it('shows its chips in order, a group for its clocks, each clock once', () => {
    const chips = [
      { clockId: 'c', groupId: null },
      { clockId: null, groupId: 'g' },
      { clockId: 'a', groupId: null },
      { clockId: 'd', groupId: null },
      { clockId: null, groupId: 'gone' },
    ] as const;
    expect(blockClocks({ allClocks: false, clockChips: [...chips] }, clocks, groups).map((c) => c.id)).toEqual(['b', 'a']);
  });
});
