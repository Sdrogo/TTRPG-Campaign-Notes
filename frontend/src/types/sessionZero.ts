import type { Reaction } from './comment';
import type { MapColor } from './map';

/** The three fixed columns of the Lines & Veils board (spec 46 Decision 10). */
export type LinesVeilsKind = 'must' | 'veils' | 'lines';

/** The two fixed columns of a Stars and Wishes step (spec 47 Decision 7). */
export type StarsWishesKind = 'stars' | 'wishes';

/** What a step of a session's chain is (spec 47 Decision 1). */
export type ModuleKind = 'retro' | 'lines_veils' | 'stars_wishes' | 'questions' | 'ddi' | 'poll';

/** A step of a new session's chain; `carry` brings an earlier session's content over (spec 47b). */
export interface ChainStep {
  kind: ModuleKind;
  carry: boolean;
}

/** Who sees who voted for each choice (spec 53 Decision 2). */
export type PollVotersVisible = 'master' | 'everyone' | 'nobody';

/** A live tally, or a secret one the Master reveals (spec 53 Decision 2). */
export type PollResults = 'live' | 'hidden';

/**
 * A choice of a poll: `count` is null while the tally is hidden from the
 * viewer, `voters` while the names are; `winner` once the poll is closed.
 */
export interface PollOption {
  id: string;
  body: string;
  count: number | null;
  voters: string[] | null;
  winner: boolean;
}

/**
 * A poll (spec 53 Decisions 2-6): its settings, its choices, the viewer's
 * own vote, how many of the `electorate` voted and, for whoever sees names,
 * who hasn't yet.
 */
export interface Poll {
  id: string;
  body: string;
  hint: string | null;
  maxChoices: number;
  masterVotes: boolean;
  votersVisible: PollVotersVisible;
  results: PollResults;
  revealed: boolean;
  closed: boolean;
  hasVotes: boolean;
  options: PollOption[];
  myOptionIds: string[];
  voterCount: number;
  electorate: number;
  notVoted: string[] | null;
  tallyVisible: boolean;
  canVote: boolean;
}

/** A Player's "I have read and accept" (spec 47 Decision 8); `outdated` once the Document changed after it. */
export interface Acceptance {
  userId: string;
  acceptedAt: string;
  outdated: boolean;
  mine: boolean;
}

/**
 * A DDI step (spec 47 Decision 8): `documentId` is its Document when the
 * viewer sees it, `documentHidden` says there is one they don't see yet.
 * The Master gets every acceptance, a Player their own; `canAccept` while
 * the viewer may accept (again, once the Document changed).
 */
export interface DdiStep {
  documentId: string | null;
  documentHidden: boolean;
  changedAt: string | null;
  acceptances: Acceptance[];
  canAccept: boolean;
}

/** Where a question's answer goes in the Player's Document (spec 47 Decision 9). */
export type QuestionTarget = 'name' | 'subtitle' | 'description' | 'note' | 'document' | 'none';

/** A question of a Questions step; `tagId` is the Tag of a "New Document" question's Document. */
export interface Question {
  id: string;
  position: number;
  body: string;
  hint: string | null;
  target: QuestionTarget;
  tagId: string | null;
}

/** An answer the viewer may read (Decision 10): their own, or everyone's for the Master or once revealed. */
export interface Answer {
  questionId: string;
  userId: string;
  body: string;
  /** A Note answer's Note is made Private (Q3). */
  notePrivate: boolean;
  updatedAt: string;
  mine: boolean;
}

/** A Document made from a Player's answers: their own (`questionId` null) or a "New Document" question's. */
export interface AnswerDocument {
  userId: string;
  questionId: string | null;
  documentId: string;
  mine: boolean;
}

/**
 * A Questions step (spec 47 Decisions 9-11): its settings, questions, the
 * answers and Documents the viewer may see. `canCreate`: the viewer may make
 * their Document now; `creatable`: for the Master, how many Players
 * "Create everyone's Documents" would make one for.
 */
export interface QuestionsStep {
  tagId: string | null;
  answersRevealed: boolean;
  playersBypassCreationRule: boolean;
  questions: Question[];
  answers: Answer[];
  documents: AnswerDocument[];
  canCreate: boolean;
  creatable: number;
}

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
 * Wishes step's columns; none for Lines & Veils, whose board is the Room's,
 * or for Questions, DDI and Poll, which have `questions`, `ddi` and `polls`.
 */
export interface SessionZeroModule {
  id: string;
  kind: ModuleKind;
  position: number;
  columns: PostItColumn[];
  /** A Questions step's content (spec 47_2). */
  questions?: QuestionsStep;
  /** A DDI step's content (spec 47_3). */
  ddi?: DdiStep;
  /** A Poll step's polls (spec 53). */
  polls?: Poll[];
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
