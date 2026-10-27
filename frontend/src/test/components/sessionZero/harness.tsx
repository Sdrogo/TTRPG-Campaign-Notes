import type { ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { BoardContext } from '../../../components/sessionZero/boardContext';
import { toSessionZero, type RawSessionZero } from '../../../lib/sessionZero';
import type { Member } from '../../../types/member';
import type { PostIt, PostItColumn } from '../../../types/sessionZero';
import { rawPostIt, rawPostItColumn, rawSessionZero } from '../../fixtures';
import { renderWithProviders } from '../../utils';

export const members: Member[] = [
  {
    userId: 'user-2',
    role: 'player',
    isAdmin: false,
    email: null,
    displayName: 'Bianca',
    pronouns: null,
    bio: null,
    avatarUrl: null,
  },
];

/** A column in the page's model, from `rawPostItColumn`'s overrides. */
export function column(overrides: Record<string, unknown> = {}): PostItColumn {
  return toSessionZero(rawSessionZero({ retro: [rawPostItColumn(overrides)] }) as RawSessionZero).retro[0];
}

/** A post-it in the page's model, from `rawPostIt`'s overrides. */
export function postIt(overrides: Record<string, unknown> = {}): PostIt {
  return column({ cards: [rawPostIt(overrides)] }).cards[0];
}

interface Options {
  board?: Record<string, unknown>;
  writable?: boolean;
  busy?: boolean;
}

/**
 * Renders a piece of the Session 0 page inside its board context; `act`
 * records the writes and reports each one done at once.
 */
export function renderBoard(ui: ReactElement, { board = {}, writable = true, busy = false }: Options = {}) {
  const act = vi.fn((_write: unknown, onDone?: () => void) => onDone?.());
  const value = {
    board: toSessionZero(rawSessionZero(board) as RawSessionZero),
    members,
    act,
    busy,
    writable,
  };
  renderWithProviders(<BoardContext.Provider value={value}>{ui}</BoardContext.Provider>);
  return { act, user: userEvent.setup() };
}
