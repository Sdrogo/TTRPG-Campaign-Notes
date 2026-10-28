import { describe, expect, it } from 'vitest';
import {
  boardWrites,
  columnColor,
  formatClock,
  moduleLabel,
  questionsProblem,
  roundLabel,
  secondsLeft,
  shownModule,
  toSessionZero,
  viewOf,
  withView,
  type RawSessionZero,
} from '../../lib/sessionZero';
import type { SessionZeroTimer } from '../../types/sessionZero';
import { rawPostIt, rawPostItColumn, rawSessionZero } from '../fixtures';

function timer(overrides: Partial<SessionZeroTimer> = {}): SessionZeroTimer {
  return {
    state: 'running',
    durationS: 600,
    endsAt: '2026-10-27T10:10:00Z',
    remainingS: null,
    now: '2026-10-27T10:00:00Z',
    ...overrides,
  };
}

describe('toSessionZero', () => {
  it('reads the boards in camelCase, reactions and timer included', () => {
    const board = toSessionZero(
      rawSessionZero({
        can_manage: true,
        retro: [
          rawPostItColumn({
            title: 'Con cura',
            color: 'gold',
            groups: [{ id: 'g-1', title: 'Draghi' }],
            cards: [
              rawPostIt({
                from_retro: true,
                group_id: 'g-1',
                reactions: [{ emoji: '🎲', count: 1, reacted_by_me: true, user_ids: ['user-1'] }],
                can_promote: true,
                can_group: true,
              }),
            ],
          }),
        ],
        timer: { state: 'paused', duration_s: 300, ends_at: null, remaining_s: 120, now: '2026-10-27T10:00:00Z' },
      }) as RawSessionZero,
    );

    expect(board.canManage).toBe(true);
    expect(board.rounds[0]).toEqual({
      id: 'round-1',
      number: 1,
      title: null,
      startedAt: '2026-10-27T09:00:00Z',
      closedAt: null,
    });
    expect(board.retro[0].cards[0]).toMatchObject({
      columnId: 'col-1',
      authorId: 'user-1',
      groupId: 'g-1',
      fromRetro: true,
      canPromote: true,
      canGroup: true,
      reactions: [{ emoji: '🎲', count: 1, reactedByMe: true, userIds: ['user-1'] }],
    });
    expect(board.retro[0]).toMatchObject({ color: 'gold', groups: [{ id: 'g-1', title: 'Draghi' }] });
    expect(board.linesVeils.map((column) => [column.kind, column.color])).toEqual([
      ['must', 'green'],
      ['veils', 'gold'],
      ['lines', 'red'],
    ]);
    expect(columnColor(board.retro[0])).toBe('var(--mantine-color-yellow-5)');
    expect(board.timer).toEqual({
      state: 'paused',
      durationS: 300,
      endsAt: null,
      remainingS: 120,
      now: '2026-10-27T10:00:00Z',
    });
  });

  // Spec 47_2: a Questions step's content.
  it('reads a Questions step', () => {
    const questions = {
      tag_id: 'tag',
      answers_revealed: true,
      players_bypass_creation_rule: false,
      questions: [{ id: 'q', position: 0, body: 'Nome?', hint: 'Il tuo', target: 'name', tag_id: null }],
      answers: [{ question_id: 'q', user_id: 'u', body: 'Ireena', note_private: false, updated_at: 'now', mine: true }],
      documents: [{ user_id: 'u', question_id: null, document_id: 'd', mine: true }],
      can_create: false,
      creatable: 2,
    };
    const board = toSessionZero(
      rawSessionZero({ modules: [{ id: 'm', kind: 'questions', position: 0, columns: [], questions }] }) as RawSessionZero,
    );
    expect(board.modules[0].questions).toEqual({
      tagId: 'tag',
      answersRevealed: true,
      playersBypassCreationRule: false,
      questions: [{ id: 'q', position: 0, body: 'Nome?', hint: 'Il tuo', target: 'name', tagId: null }],
      answers: [{ questionId: 'q', userId: 'u', body: 'Ireena', notePrivate: false, updatedAt: 'now', mine: true }],
      documents: [{ userId: 'u', questionId: null, documentId: 'd', mine: true }],
      canCreate: false,
      creatable: 2,
    });
    expect(toSessionZero(rawSessionZero() as RawSessionZero).modules[0]).not.toHaveProperty('questions');
  });

  it('keeps a missing timer missing', () => {
    expect(toSessionZero(rawSessionZero() as RawSessionZero).timer).toBeNull();
  });
});

describe('boardWrites', () => {
  it('names every write the page sends', () => {
    expect(boardWrites.start()).toEqual({ path: '/start', method: 'POST' });
    expect(boardWrites.addPostIt('col-1', 'Ciao')).toEqual({
      path: '/cards',
      method: 'POST',
      json: { column_id: 'col-1', body: 'Ciao' },
    });
    expect(boardWrites.editPostIt('c', 'B')).toEqual({ path: '/cards/c', method: 'PATCH', json: { body: 'B' } });
    expect(boardWrites.deletePostIt('c')).toEqual({ path: '/cards/c', method: 'DELETE' });
    expect(boardWrites.publish('c', true)).toEqual({
      path: '/cards/c/publish',
      method: 'POST',
      json: { anonymous: true },
    });
    expect(boardWrites.promote('c', 'lv')).toEqual({
      path: '/cards/c/promote',
      method: 'POST',
      json: { column_id: 'lv' },
    });
    expect(boardWrites.move('c', 'lv')).toEqual({ path: '/cards/c/move', method: 'POST', json: { column_id: 'lv' } });
    expect(boardWrites.react('c', '👍', true)).toEqual({
      path: `/cards/c/reactions/${encodeURIComponent('👍')}`,
      method: 'PUT',
    });
    expect(boardWrites.react('c', '👍', false).method).toBe('DELETE');
    expect(boardWrites.publishAll(false)).toEqual({
      path: '/cards/publish-all',
      method: 'POST',
      json: { anonymous: false },
    });
    expect(boardWrites.addColumn('X', 'blue', 'm')).toEqual({
      path: '/columns',
      method: 'POST',
      json: { title: 'X', color: 'blue', module_id: 'm' },
    });
    expect(boardWrites.recolorColumn('k', 'red')).toEqual({
      path: '/columns/k',
      method: 'PATCH',
      json: { color: 'red' },
    });
    expect(boardWrites.renameColumn('k', 'Y')).toEqual({ path: '/columns/k', method: 'PATCH', json: { title: 'Y' } });
    expect(boardWrites.deleteColumn('k')).toEqual({ path: '/columns/k', method: 'DELETE' });
    expect(boardWrites.reorderColumns(['b', 'a'])).toEqual({
      path: '/columns/order',
      method: 'PUT',
      json: { column_ids: ['b', 'a'] },
    });
    expect(boardWrites.startRound('  Fine arco 1 ', ['retro'])).toEqual({
      path: '/rounds',
      method: 'POST',
      json: { title: 'Fine arco 1', modules: ['retro'] },
    });
    expect(boardWrites.startRound('  ', ['stars_wishes']).json).toEqual({ title: null, modules: ['stars_wishes'] });
    expect(boardWrites.start(['retro', 'stars_wishes']).json).toEqual({ modules: ['retro', 'stars_wishes'] });
    expect(boardWrites.addModule('lines_veils')).toEqual({
      path: '/modules',
      method: 'POST',
      json: { kind: 'lines_veils' },
    });
    expect(boardWrites.removeModule('m')).toEqual({ path: '/modules/m', method: 'DELETE' });
    expect(boardWrites.reorderModules(['b', 'a'])).toEqual({
      path: '/modules/order',
      method: 'PUT',
      json: { module_ids: ['b', 'a'] },
    });
    expect(boardWrites.setCurrentModule('m')).toEqual({
      path: '/modules/current',
      method: 'PUT',
      json: { module_id: 'm' },
    });
    expect(boardWrites.timer('start', 10)).toEqual({
      path: '/timer',
      method: 'POST',
      json: { action: 'start', duration_s: 600 },
    });
    expect(boardWrites.timer('pause').json).toEqual({ action: 'pause' });
    expect(boardWrites.group(['a', 'b'])).toEqual({ path: '/groups', method: 'POST', json: { card_ids: ['a', 'b'] } });
    expect(boardWrites.renameGroup('g', ' Draghi ')).toEqual({
      path: '/groups/g',
      method: 'PATCH',
      json: { title: 'Draghi' },
    });
    expect(boardWrites.ungroupAll('g')).toEqual({ path: '/groups/g', method: 'DELETE' });
    expect(boardWrites.ungroup('c')).toEqual({ path: '/cards/c/ungroup', method: 'POST' });
    expect(boardWrites.deleteSessionZero()).toEqual({ path: '', method: 'DELETE' });
  });

  // Spec 47_2: the Questions step's writes.
  it('names the Questions step\'s writes', () => {
    expect(boardWrites.setQuestionsTag('m', null)).toEqual({ path: '/modules/m', method: 'PATCH', json: { tag_id: null } });
    expect(boardWrites.setCreationBypass('m', false)).toEqual({
      path: '/modules/m',
      method: 'PATCH',
      json: { players_bypass_creation_rule: false },
    });
    expect(
      boardWrites.setQuestions('m', [
        { id: 'q', body: 'Nome?', hint: '  ', target: 'name', tagId: 'tag' },
        { id: null, body: 'PNG?', hint: ' Uno ', target: 'document', tagId: 'tag' },
      ]),
    ).toEqual({
      path: '/modules/m/questions',
      method: 'PUT',
      json: {
        questions: [
          { id: 'q', body: 'Nome?', hint: null, target: 'name', tag_id: null },
          { id: null, body: 'PNG?', hint: 'Uno', target: 'document', tag_id: 'tag' },
        ],
      },
    });
    expect(boardWrites.saveAnswers('m', [{ questionId: 'q', body: 'Ireena', notePrivate: true }])).toEqual({
      path: '/modules/m/answers',
      method: 'PUT',
      json: { answers: [{ question_id: 'q', body: 'Ireena', note_private: true }] },
    });
    expect(boardWrites.revealAnswers('m', true)).toEqual({ path: '/modules/m/reveal', method: 'PUT', json: { revealed: true } });
    expect(boardWrites.createMyDocument('m')).toEqual({ path: '/modules/m/documents', method: 'POST' });
    expect(boardWrites.createEveryoneDocuments('m')).toEqual({ path: '/modules/m/documents/all', method: 'POST' });
  });
});

describe('questionsProblem', () => {
  const question = (target: string, body = 'Domanda?') =>
    ({ id: null, body, hint: '', target, tagId: null }) as Parameters<typeof questionsProblem>[0][number];

  // Spec 47 Decision 9.
  it('wants text, one Name, at most one Subtitle and five New Documents', () => {
    expect(questionsProblem([])).toBeNull();
    expect(questionsProblem([question('name'), question('subtitle'), question('none')])).toBeNull();
    expect(questionsProblem([question('name', ' ')])).toBe('sessionZero.questions.problems.empty');
    expect(questionsProblem([question('note')])).toBe('sessionZero.questions.problems.oneName');
    expect(questionsProblem([question('name'), question('name')])).toBe('sessionZero.questions.problems.oneName');
    expect(questionsProblem([question('name'), question('subtitle'), question('subtitle')])).toBe(
      'sessionZero.questions.problems.oneSubtitle',
    );
    expect(questionsProblem([question('name'), ...Array.from({ length: 6 }, () => question('document'))])).toBe(
      'sessionZero.questions.problems.documents',
    );
  });
});

describe('the step on screen', () => {
  const modules = [
    { id: 'm1', kind: 'retro', position: 0, columns: [rawPostItColumn({ id: 'a' })] },
    { id: 'm2', kind: 'stars_wishes', position: 1, columns: [rawPostItColumn({ id: 'b', kind: 'stars' })] },
  ];
  const board = toSessionZero(rawSessionZero({ modules, current_module_id: 'm2' }) as RawSessionZero);

  // Spec 47: the step opened, else the current one, else the first.
  it('picks the step opened, the current one or the first', () => {
    expect(board.retro.map((column) => column.id)).toEqual(['b']);
    expect(shownModule(board, 'm1')?.id).toBe('m1');
    expect(shownModule(board, 'gone')?.id).toBe('m2');
    expect(shownModule({ ...board, currentModuleId: null }, null)?.id).toBe('m1');
    expect(shownModule({ ...board, modules: [] }, null)).toBeUndefined();
    expect(moduleLabel('stars_wishes')).toBe('Stelle e Desideri');
  });

  it('shows a step\'s columns and writes a preview back into it', () => {
    const view = viewOf(board, board.modules[0]);
    expect(view.retro.map((column) => column.id)).toEqual(['a']);
    expect(viewOf(board, undefined).retro).toEqual([]);
    const preview = { ...view, retro: [] };
    expect(withView(preview, 'm1')!.modules.map((module) => module.columns.length)).toEqual([0, 1]);
    expect(withView(undefined, 'm1')).toBeUndefined();
  });
});

describe('roundLabel', () => {
  const round = { id: 'r', startedAt: '', closedAt: null };

  // Spec 46d Decision 3: a session's own name replaces the default.
  it('names the first round Session 0, later ones Session 0.5 with their number, or by their own name', () => {
    expect(roundLabel({ ...round, number: 1, title: null })).toBe('Sessione 0');
    expect(roundLabel({ ...round, number: 3, title: null })).toBe('Sessione 0.5 #2');
    expect(roundLabel({ ...round, number: 3, title: 'Fine arco 1' })).toBe('Fine arco 1');
  });
});

describe('secondsLeft', () => {
  const readAt = Date.parse('2026-10-27T10:00:00Z');

  it('counts down to the end time, never below zero', () => {
    expect(secondsLeft(timer(), readAt + 60_000, readAt)).toBe(540);
    expect(secondsLeft(timer(), readAt + 3_600_000, readAt)).toBe(0);
  });

  it("corrects for this clock running ahead of the server's", () => {
    // Read when this clock said 10:00:30 while the server said 10:00:00.
    expect(secondsLeft(timer(), readAt + 30_000, readAt + 30_000)).toBe(600);
  });

  it('freezes a paused timer and has nothing to show when stopped', () => {
    expect(secondsLeft(timer({ state: 'paused', endsAt: null, remainingS: 42 }), readAt, readAt)).toBe(42);
    expect(secondsLeft(timer({ state: 'stopped', endsAt: null }), readAt, readAt)).toBeNull();
    expect(secondsLeft(timer({ endsAt: null }), readAt, readAt)).toBeNull();
  });
});

describe('formatClock', () => {
  it('writes minutes and two-digit seconds', () => {
    expect(formatClock(605)).toBe('10:05');
    expect(formatClock(59)).toBe('0:59');
  });
});
