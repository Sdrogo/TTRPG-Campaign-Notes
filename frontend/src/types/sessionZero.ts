import type { Reaction } from './comment';
import type { MapColor } from './map';

/** The three fixed columns of the Lines & Veils board (spec 46 Decision 10). */
export type LinesVeilsKind = 'must' | 'veils' | 'lines';

/** The two fixed columns of a Stars and Wishes step (spec 47 Decision 7). */
export type StarsWishesKind = 'stars' | 'wishes';

/** What a step of a session's chain is (spec 47 Decision 1). */
export type ModuleKind = 'retro' | 'lines_veils' | 'stars_wishes';

/** What the Master can do with the shared timer (spec 46 Decision 4). */
export type TimerAction = 'start' | 'pause' | 'resume' | 'stop';

/**
 * A post-it as the viewer sees it. `authorId` is null on someone else's
 * anonymous post-it (Decision 7); `fromRetro` marks a Lines & Veils copy
 * (Decision 2); `groupId` its group (spec 46c Decision 9); `position` its
 * place in its group, or among its column's post-its in no group and its
 * groups (spec 46d Decision 7). The `can*` flags come from the backend and
 * drive the menu and the drag (`canPlace`).
 */
export interface PostIt {
  id: string;
  columnId: string;
  groupId: string | null;
  position: number;
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
  canGroup: boolean;
  canPlace: boolean;
}

/**
 * Related post-its of a Retro column (spec 46c Decision 9), gathered by the
 * Master or by a Player from their own (spec 46d Q2), at `position` among
 * the column's post-its in no group.
 */
export interface PostItGroup {
  id: string;
  title: string | null;
  position: number;
}

/**
 * A column, its groups and its post-its, in order; `kind` is set on the
 * fixed ones, Lines & Veils and Stars and Wishes; `color` comes from the
 * maps' palette (spec 46c Decision 5).
 */
export interface PostItColumn {
  id: string;
  kind: LinesVeilsKind | StarsWishesKind | null;
  title: string;
  color: MapColor;
  groups: PostItGroup[];
  cards: PostIt[];
}

/**
 * A step of the shown session's chain (spec 47): a Retro or Stars and
 * Wishes step's columns; none for Lines & Veils, whose board is the Room's.
 */
export interface SessionZeroModule {
  id: string;
  kind: ModuleKind;
  position: number;
  columns: PostItColumn[];
}

/** A session (round): 1 is the Session 0, later ones freely named (Decision 16, spec 46d). */
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
  /** The session shown. */
  roundId: string | null;
  /** Its chain as the viewer sees it (spec 47 Decision 5: a Player the steps reached). */
  modules: SessionZeroModule[];
  currentModuleId: string | null;
  /** How many later steps a Player doesn't see yet. */
  hiddenModules: number;
  /** The post-it board of the step on screen (`viewOf`): what the boards and the drag work on. */
  retro: PostItColumn[];
  linesVeils: PostItColumn[];
  timer: SessionZeroTimer | null;
}
