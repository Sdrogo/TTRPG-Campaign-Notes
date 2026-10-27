import { describe, expect, it } from 'vitest';
import {
  boardWrites,
  formatClock,
  roundLabel,
  secondsLeft,
  toSessionZero,
  type RawSessionZero,
} from '../../lib/sessionZero';
import type { SessionZeroTimer } from '../../types/sessionZero';
import { rawPostIt, rawSessionZero } from '../fixtures';

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
          {
            id: 'col-1',
            kind: null,
            title: 'Domande',
            cards: [
              rawPostIt({
                from_retro: true,
                reactions: [{ emoji: '🎲', count: 1, reacted_by_me: true, user_ids: ['user-1'] }],
                can_promote: true,
              }),
            ],
          },
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
      fromRetro: true,
      canPromote: true,
      reactions: [{ emoji: '🎲', count: 1, reactedByMe: true, userIds: ['user-1'] }],
    });
    expect(board.linesVeils.map((column) => column.kind)).toEqual(['must', 'lines', 'veils']);
    expect(board.timer).toEqual({
      state: 'paused',
      durationS: 300,
      endsAt: null,
      remainingS: 120,
      now: '2026-10-27T10:00:00Z',
    });
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
    expect(boardWrites.addColumn('X')).toEqual({ path: '/columns', method: 'POST', json: { title: 'X' } });
    expect(boardWrites.renameColumn('k', 'Y')).toEqual({ path: '/columns/k', method: 'PATCH', json: { title: 'Y' } });
    expect(boardWrites.deleteColumn('k')).toEqual({ path: '/columns/k', method: 'DELETE' });
    expect(boardWrites.reorderColumns(['b', 'a'])).toEqual({
      path: '/columns/order',
      method: 'PUT',
      json: { column_ids: ['b', 'a'] },
    });
    expect(boardWrites.startRound('  Fine arco 1 ')).toEqual({
      path: '/rounds',
      method: 'POST',
      json: { title: 'Fine arco 1' },
    });
    expect(boardWrites.startRound('  ').json).toEqual({ title: null });
    expect(boardWrites.timer('start', 10)).toEqual({
      path: '/timer',
      method: 'POST',
      json: { action: 'start', duration_s: 600 },
    });
    expect(boardWrites.timer('pause').json).toEqual({ action: 'pause' });
  });
});

describe('roundLabel', () => {
  const round = { id: 'r', startedAt: '', closedAt: null };

  it('names the first round Session 0 and later ones Session 0.5 with their number and title', () => {
    expect(roundLabel({ ...round, number: 1, title: null })).toBe('Sessione 0');
    expect(roundLabel({ ...round, number: 3, title: 'Fine arco 1' })).toBe('Sessione 0.5 #2 · Fine arco 1');
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
