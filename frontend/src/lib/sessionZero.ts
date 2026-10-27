import i18n from '../i18n';
import type {
  LinesVeilsKind,
  PostIt,
  PostItColumn,
  SessionZero,
  SessionZeroRound,
  SessionZeroTimer,
  TimerAction,
} from '../types/sessionZero';

/** A post-it's longest text (spec 46 Decision 12); the backend enforces it too. */
export const MAX_POST_IT_LENGTH = 500;

/** A Retro column's longest title, and a round's (the backend's limits). */
export const MAX_COLUMN_TITLE_LENGTH = 60;
export const MAX_ROUND_TITLE_LENGTH = 100;

/** The most columns a Retro round holds (Decision 12). */
export const MAX_RETRO_COLUMNS = 8;

/** The timer's quick choices, in minutes (spec 46 Decision 4). */
export const TIMER_PRESETS_MIN = [5, 10, 15] as const;

/** The timer's bounds, in minutes (60 s to 1 h on the backend). */
export const TIMER_MIN_MIN = 1;
export const TIMER_MAX_MIN = 60;

/** The Lines & Veils columns in board order. */
export const LINES_VEILS_KINDS: LinesVeilsKind[] = ['must', 'lines', 'veils'];

interface RawReaction {
  emoji: string;
  count: number;
  reacted_by_me: boolean;
  user_ids: string[];
}

interface RawPostIt {
  id: string;
  column_id: string;
  body: string;
  author_id: string | null;
  anonymous: boolean;
  mine: boolean;
  draft: boolean;
  from_retro: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  reactions: RawReaction[];
  can_edit: boolean;
  can_delete: boolean;
  can_publish: boolean;
  can_promote: boolean;
  can_move: boolean;
  can_react: boolean;
}

interface RawColumn {
  id: string;
  kind: LinesVeilsKind | null;
  title: string;
  cards: RawPostIt[];
}

interface RawRound {
  id: string;
  number: number;
  title: string | null;
  started_at: string;
  closed_at: string | null;
}

interface RawTimer {
  state: SessionZeroTimer['state'];
  duration_s: number | null;
  ends_at: string | null;
  remaining_s: number | null;
  now: string;
}

/** `GET /rooms/{id}/session-zero` and every write's answer, on the wire. */
export interface RawSessionZero {
  started: boolean;
  revision: number;
  can_manage: boolean;
  rounds: RawRound[];
  round_id: string | null;
  retro: RawColumn[];
  lines_veils: RawColumn[];
  timer: RawTimer | null;
}

function toPostIt(raw: RawPostIt): PostIt {
  return {
    id: raw.id,
    columnId: raw.column_id,
    body: raw.body,
    authorId: raw.author_id,
    anonymous: raw.anonymous,
    mine: raw.mine,
    draft: raw.draft,
    fromRetro: raw.from_retro,
    publishedAt: raw.published_at,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    reactions: raw.reactions.map((reaction) => ({
      emoji: reaction.emoji,
      count: reaction.count,
      reactedByMe: reaction.reacted_by_me,
      userIds: reaction.user_ids,
    })),
    canEdit: raw.can_edit,
    canDelete: raw.can_delete,
    canPublish: raw.can_publish,
    canPromote: raw.can_promote,
    canMove: raw.can_move,
    canReact: raw.can_react,
  };
}

function toColumn(raw: RawColumn): PostItColumn {
  return { id: raw.id, kind: raw.kind, title: raw.title, cards: raw.cards.map(toPostIt) };
}

function toRound(raw: RawRound): SessionZeroRound {
  return {
    id: raw.id,
    number: raw.number,
    title: raw.title,
    startedAt: raw.started_at,
    closedAt: raw.closed_at,
  };
}

/** The page's model, from the backend's snake_case answer. */
export function toSessionZero(raw: RawSessionZero): SessionZero {
  return {
    started: raw.started,
    revision: raw.revision,
    canManage: raw.can_manage,
    rounds: raw.rounds.map(toRound),
    roundId: raw.round_id,
    retro: raw.retro.map(toColumn),
    linesVeils: raw.lines_veils.map(toColumn),
    timer: raw.timer && {
      state: raw.timer.state,
      durationS: raw.timer.duration_s,
      endsAt: raw.timer.ends_at,
      remainingS: raw.timer.remaining_s,
      now: raw.timer.now,
    },
  };
}

/** One write to the boards: the path under `/rooms/{id}/session-zero`, the method and the body. */
export interface BoardWrite {
  path: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  json?: unknown;
}

/** Every write the page sends; each answers with the open round's boards. */
export const boardWrites = {
  start: (): BoardWrite => ({ path: '/start', method: 'POST' }),
  addPostIt: (columnId: string, body: string): BoardWrite => ({
    path: '/cards',
    method: 'POST',
    json: { column_id: columnId, body },
  }),
  editPostIt: (id: string, body: string): BoardWrite => ({ path: `/cards/${id}`, method: 'PATCH', json: { body } }),
  deletePostIt: (id: string): BoardWrite => ({ path: `/cards/${id}`, method: 'DELETE' }),
  publish: (id: string, anonymous: boolean): BoardWrite => ({
    path: `/cards/${id}/publish`,
    method: 'POST',
    json: { anonymous },
  }),
  promote: (id: string, columnId: string): BoardWrite => ({
    path: `/cards/${id}/promote`,
    method: 'POST',
    json: { column_id: columnId },
  }),
  move: (id: string, columnId: string): BoardWrite => ({
    path: `/cards/${id}/move`,
    method: 'POST',
    json: { column_id: columnId },
  }),
  react: (id: string, emoji: string, add: boolean): BoardWrite => ({
    path: `/cards/${id}/reactions/${encodeURIComponent(emoji)}`,
    method: add ? 'PUT' : 'DELETE',
  }),
  addColumn: (title: string): BoardWrite => ({ path: '/columns', method: 'POST', json: { title } }),
  renameColumn: (id: string, title: string): BoardWrite => ({
    path: `/columns/${id}`,
    method: 'PATCH',
    json: { title },
  }),
  deleteColumn: (id: string): BoardWrite => ({ path: `/columns/${id}`, method: 'DELETE' }),
  reorderColumns: (ids: string[]): BoardWrite => ({
    path: '/columns/order',
    method: 'PUT',
    json: { column_ids: ids },
  }),
  startRound: (title: string): BoardWrite => ({
    path: '/rounds',
    method: 'POST',
    json: { title: title.trim() || null },
  }),
  timer: (action: TimerAction, minutes?: number): BoardWrite => ({
    path: '/timer',
    method: 'POST',
    json: minutes === undefined ? { action } : { action, duration_s: minutes * 60 },
  }),
};

/** "Session 0" for the first round, "Session 0.5 #n" after it, with the round's title. */
export function roundLabel(round: SessionZeroRound): string {
  const name =
    round.number === 1
      ? i18n.t('sessionZero.rounds.first')
      : i18n.t('sessionZero.rounds.later', { number: round.number - 1 });
  return round.title ? `${name} · ${round.title}` : name;
}

/**
 * Seconds left on a running timer at `nowMs`, counted from its end time and
 * corrected by how far the server's clock (`timer.now`) was from this one
 * when the board was read (`readAtMs`); a paused timer's frozen remainder;
 * null when stopped.
 */
export function secondsLeft(timer: SessionZeroTimer, nowMs: number, readAtMs: number): number | null {
  if (timer.state === 'paused') return timer.remainingS;
  if (timer.state === 'stopped' || timer.endsAt === null) return null;
  const skew = Date.parse(timer.now) - readAtMs;
  return Math.max(0, Math.ceil((Date.parse(timer.endsAt) - (nowMs + skew)) / 1000));
}

/** `m:ss` for a number of seconds. */
export function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The data a dragged post-it carries (native HTML5 drag, spec 46 Design 46_3). */
export const POST_IT_DRAG_TYPE = 'application/x-exlibris-post-it';

export interface DraggedPostIt {
  id: string;
  /** Promote a Retro post-it, or move a Lines & Veils one. */
  action: 'promote' | 'move';
  columnId: string;
}
