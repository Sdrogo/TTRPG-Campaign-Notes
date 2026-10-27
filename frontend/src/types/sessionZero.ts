import type { Reaction } from './comment';

/** The three fixed columns of the Lines & Veils board (spec 46 Decision 10). */
export type LinesVeilsKind = 'must' | 'lines' | 'veils';

/** What the Master can do with the shared timer (spec 46 Decision 4). */
export type TimerAction = 'start' | 'pause' | 'resume' | 'stop';

/**
 * A post-it as the viewer sees it. `authorId` is null on someone else's
 * anonymous post-it (Decision 7); `fromRetro` marks a Lines & Veils copy
 * (Decision 2). The `can*` flags come from the backend and drive the menu.
 */
export interface PostIt {
  id: string;
  columnId: string;
  body: string;
  authorId: string | null;
  anonymous: boolean;
  mine: boolean;
  draft: boolean;
  fromRetro: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  reactions: Reaction[];
  canEdit: boolean;
  canDelete: boolean;
  canPublish: boolean;
  canPromote: boolean;
  canMove: boolean;
  canReact: boolean;
}

/** A column and its post-its, oldest first; `kind` is set on Lines & Veils. */
export interface PostItColumn {
  id: string;
  kind: LinesVeilsKind | null;
  title: string;
  cards: PostIt[];
}

/** A round of the Retro board: 1 is the Session 0, later ones Session 0.5 (Decision 16). */
export interface SessionZeroRound {
  id: string;
  number: number;
  title: string | null;
  startedAt: string;
  closedAt: string | null;
}

/** The shared timer as the server saw it at `now`. */
export interface SessionZeroTimer {
  state: 'running' | 'paused' | 'stopped';
  durationS: number | null;
  endsAt: string | null;
  remainingS: number | null;
  now: string;
}

/** A Room's Session 0 page (`GET /rooms/{id}/session-zero`). */
export interface SessionZero {
  started: boolean;
  revision: number;
  canManage: boolean;
  rounds: SessionZeroRound[];
  /** The round shown on the Retro board. */
  roundId: string | null;
  retro: PostItColumn[];
  linesVeils: PostItColumn[];
  timer: SessionZeroTimer | null;
}
