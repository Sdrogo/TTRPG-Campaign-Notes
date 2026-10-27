import { createContext, useContext } from 'react';
import type { BoardWrite } from '../../lib/sessionZero';
import type { Member } from '../../types/member';
import type { SessionZero } from '../../types/sessionZero';

/** What every part of the Session 0 page needs to act on the boards. */
export interface BoardContextValue {
  board: SessionZero;
  members: Member[];
  /** Sends a write; a failure shows as a toast, `onDone` runs once it succeeds. */
  act: (write: BoardWrite, onDone?: () => void) => void;
  /** A write is on its way: controls wait for it. */
  busy: boolean;
  /** False while the Master previews the Room as a member (spec 22b): nothing writes. */
  writable: boolean;
  /** Ids of the post-its, columns and groups another member just changed (spec 46_4). */
  glowing: ReadonlySet<string>;
}

export const BoardContext = createContext<BoardContextValue | null>(null);

/** The page's board and its actions; only rendered inside `SessionZeroPage`. */
export function useBoard(): BoardContextValue {
  return useContext(BoardContext)!;
}
