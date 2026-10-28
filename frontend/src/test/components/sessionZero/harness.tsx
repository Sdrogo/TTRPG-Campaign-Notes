import type { ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { BoardContext } from '../../../components/sessionZero/boardContext';
import { DndStateContext, type DndState } from '../../../components/sessionZero/boardDrag';
import { shownModule, toSessionZero, viewOf, type RawSessionZero } from '../../../lib/sessionZero';
import type { Member } from '../../../types/member';
import type { PostIt, PostItColumn, SessionZero } from '../../../types/sessionZero';
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
  glowing?: string[];
  /** A drag in progress, for what the post-its, groups and columns show while it lasts. */
  dnd?: DndState;
  /** The step on screen (spec 47); the current one when left out. */
  shownId?: string;
  /** The boards a write answers with (`board` when left out). */
  next?: Record<string, unknown>;
  /** The Room's members (`members` above when left out). */
  roomMembers?: Member[];
}

/**
 * Renders a piece of the Session 0 page inside its board context; `act`
 * records the writes and reports each one done at once.
 */
export function renderBoard(ui: ReactElement, { board = {}, writable = true, busy = false, glowing = [], dnd = { active: null, intent: null }, shownId, next, roomMembers = members }: Options = {}) {
  const raw = toSessionZero(rawSessionZero(board) as RawSessionZero);
  const answer = next ? toSessionZero(rawSessionZero(next) as RawSessionZero) : raw;
  const act = vi.fn((_write: unknown, onDone?: (next: SessionZero) => void) => onDone?.(answer));
  const module = shownModule(raw, shownId ?? null);
  const value = {
    board: viewOf(raw, module),
    module,
    members: roomMembers,
    act,
    busy,
    writable,
    glowing: new Set(glowing),
  };
  renderWithProviders(
    <BoardContext.Provider value={value}>
      <DndStateContext.Provider value={dnd}>{ui}</DndStateContext.Provider>
    </BoardContext.Provider>,
  );
  return { act, user: userEvent.setup() };
}
