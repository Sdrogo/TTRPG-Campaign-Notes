import type { ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { BoardContext } from '../../../components/sessionZero/boardContext';
import { toSessionZero, type RawSessionZero } from '../../../lib/sessionZero';
import type { Member } from '../../../types/member';
import type { PostIt } from '../../../types/sessionZero';
import { rawPostIt, rawSessionZero } from '../../fixtures';
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

/** A post-it in the page's model, from `rawPostIt`'s overrides. */
export function postIt(overrides: Record<string, unknown> = {}): PostIt {
  return toSessionZero(rawSessionZero({ retro: [{ id: 'col-1', kind: null, title: 'T', cards: [rawPostIt(overrides)] }] }) as RawSessionZero)
    .retro[0].cards[0];
}

interface Options {
  board?: Record<string, unknown>;
  writable?: boolean;
  busy?: boolean;
}

/** Renders a piece of the Session 0 page inside its board context; `act` records the writes. */
export function renderBoard(ui: ReactElement, { board = {}, writable = true, busy = false }: Options = {}) {
  const act = vi.fn();
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
