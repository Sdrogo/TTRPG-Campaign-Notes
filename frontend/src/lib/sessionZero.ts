import i18n from '../i18n';
import { colorValue } from './maps';
import type { MapColor } from '../types/map';
import type {
  LinesVeilsKind,
  ModuleKind,
  PostIt,
  PostItColumn,
  SessionZero,
  SessionZeroModule,
  SessionZeroRound,
  SessionZeroTimer,
  StarsWishesKind,
  TimerAction,
} from '../types/sessionZero';

/** A post-it's longest text (spec 46 Decision 12); the backend enforces it too. */
export const MAX_POST_IT_LENGTH = 500;

/** A Retro column's longest title, and a round's (the backend's limits). */
export const MAX_COLUMN_TITLE_LENGTH = 60;
export const MAX_ROUND_TITLE_LENGTH = 100;

/** The most post-its a board holds (Decision 12). */
export const MAX_CARDS_PER_BOARD = 200;

/** The most columns a Retro round holds (Decision 12). */
export const MAX_RETRO_COLUMNS = 8;

/** The timer's quick choices, in minutes (spec 46 Decision 4). */
export const TIMER_PRESETS_MIN = [5, 10, 15] as const;

/** The timer's bounds, in minutes (60 s to 1 h on the backend). */
export const TIMER_MIN_MIN = 1;
export const TIMER_MAX_MIN = 60;

/** The Lines & Veils columns in board order, a traffic light (spec 46c Decision 5). */
export const LINES_VEILS_KINDS: LinesVeilsKind[] = ['must', 'veils', 'lines'];

/** A group's longest title (the backend's limit). */
export const MAX_GROUP_TITLE_LENGTH = 60;

/** The most steps a session's chain holds (spec 47 Decision 1). */
export const MAX_MODULES = 10;

/** The steps the Master picks from (spec 47), in the order they are offered. */
export const MODULE_KINDS: ModuleKind[] = ['retro', 'lines_veils', 'stars_wishes'];

/** A chain nobody composed: the page as it was before spec 47 (Decision 2). */
export const DEFAULT_CHAIN: ModuleKind[] = ['retro', 'lines_veils'];

interface RawReaction {
  emoji: string;
  count: number;
  reacted_by_me: boolean;
  user_ids: string[];
}

interface RawPostIt {
  id: string;
  column_id: string;
  group_id: string | null;
  position: number;
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
  can_group: boolean;
  can_place: boolean;
}

interface RawColumn {
  id: string;
  kind: LinesVeilsKind | StarsWishesKind | null;
  title: string;
  color: MapColor;
  groups: { id: string; title: string | null; position: number }[];
  cards: RawPostIt[];
}

interface RawModule {
  id: string;
  kind: ModuleKind;
  position: number;
  columns: RawColumn[];
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
  modules: RawModule[];
  current_module_id: string | null;
  hidden_modules: number;
  lines_veils: RawColumn[];
  timer: RawTimer | null;
}

function toPostIt(raw: RawPostIt): PostIt {
  return {
    id: raw.id,
    columnId: raw.column_id,
    groupId: raw.group_id,
    position: raw.position,
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
    canGroup: raw.can_group,
    canPlace: raw.can_place,
  };
}

function toColumn(raw: RawColumn): PostItColumn {
  return {
    id: raw.id,
    kind: raw.kind,
    title: raw.title,
    color: raw.color,
    groups: raw.groups.map((group) => ({ id: group.id, title: group.title, position: group.position })),
    cards: raw.cards.map(toPostIt),
  };
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

/** The page's model, from the backend's snake_case answer, showing the current step. */
export function toSessionZero(raw: RawSessionZero): SessionZero {
  const modules: SessionZeroModule[] = raw.modules.map((module) => ({
    id: module.id,
    kind: module.kind,
    position: module.position,
    columns: module.columns.map(toColumn),
  }));
  return {
    started: raw.started,
    revision: raw.revision,
    canManage: raw.can_manage,
    rounds: raw.rounds.map(toRound),
    roundId: raw.round_id,
    modules,
    currentModuleId: raw.current_module_id,
    hiddenModules: raw.hidden_modules,
    retro: modules.find((module) => module.id === raw.current_module_id)?.columns ?? [],
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

/** The step on screen: `moduleId` when the viewer still sees it, else the current one. */
export function shownModule(board: SessionZero, moduleId: string | null): SessionZeroModule | undefined {
  return (
    board.modules.find((module) => module.id === moduleId) ??
    board.modules.find((module) => module.id === board.currentModuleId) ??
    board.modules[0]
  );
}

/** The board with `module`'s columns as its post-it board (`retro`), which the boards and the drag work on. */
export function viewOf(board: SessionZero, module: SessionZeroModule | undefined): SessionZero {
  return { ...board, retro: module?.columns ?? [] };
}

/** A preview of the step on screen (a drag's), written back into its module so the page shows it. */
export function withView(preview: SessionZero | undefined, moduleId: string | undefined): SessionZero | undefined {
  if (!preview) return undefined;
  return {
    ...preview,
    modules: preview.modules.map((module) =>
      module.id === moduleId ? { ...module, columns: preview.retro } : module,
    ),
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
  /** Spec 47 Decision 2: the Master's chain; none for a Player, who gets the default. */
  start: (modules?: ModuleKind[]): BoardWrite => ({
    path: '/start',
    method: 'POST',
    json: modules ? { modules } : undefined,
  }),
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
  publishAll: (anonymous: boolean): BoardWrite => ({
    path: '/cards/publish-all',
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
  addColumn: (title: string, color: MapColor, moduleId: string | null): BoardWrite => ({
    path: '/columns',
    method: 'POST',
    json: { title, color, module_id: moduleId },
  }),
  renameColumn: (id: string, title: string): BoardWrite => ({
    path: `/columns/${id}`,
    method: 'PATCH',
    json: { title },
  }),
  recolorColumn: (id: string, color: MapColor): BoardWrite => ({
    path: `/columns/${id}`,
    method: 'PATCH',
    json: { color },
  }),
  deleteColumn: (id: string): BoardWrite => ({ path: `/columns/${id}`, method: 'DELETE' }),
  reorderColumns: (ids: string[]): BoardWrite => ({
    path: '/columns/order',
    method: 'PUT',
    json: { column_ids: ids },
  }),
  startRound: (title: string, modules: ModuleKind[]): BoardWrite => ({
    path: '/rounds',
    method: 'POST',
    json: { title: title.trim() || null, modules },
  }),
  /** Spec 47 Decision 3: a step added at the end of the open session's chain. */
  addModule: (kind: ModuleKind): BoardWrite => ({ path: '/modules', method: 'POST', json: { kind } }),
  removeModule: (id: string): BoardWrite => ({ path: `/modules/${id}`, method: 'DELETE' }),
  reorderModules: (ids: string[]): BoardWrite => ({
    path: '/modules/order',
    method: 'PUT',
    json: { module_ids: ids },
  }),
  /** Spec 47 Decision 4: the table moves to this step ("Next" is the one after the current). */
  setCurrentModule: (id: string): BoardWrite => ({
    path: '/modules/current',
    method: 'PUT',
    json: { module_id: id },
  }),
  group: (cardIds: string[]): BoardWrite => ({ path: '/groups', method: 'POST', json: { card_ids: cardIds } }),
  renameGroup: (id: string, title: string): BoardWrite => ({
    path: `/groups/${id}`,
    method: 'PATCH',
    json: { title: title.trim() || null },
  }),
  ungroupAll: (id: string): BoardWrite => ({ path: `/groups/${id}`, method: 'DELETE' }),
  ungroup: (cardId: string): BoardWrite => ({ path: `/cards/${cardId}/ungroup`, method: 'POST' }),
  /** Spec 46d Decision 7: a post-it dropped in a column, in a group or none, before another or last. */
  placeCard: (id: string, columnId: string, groupId: string | null, beforeId: string | null): BoardWrite => ({
    path: `/cards/${id}/place`,
    method: 'PUT',
    json: { column_id: columnId, group_id: groupId, before_id: beforeId },
  }),
  /** Spec 46d Decision 7: a group dropped in a column, before a post-it or group, or last. */
  placeGroup: (id: string, columnId: string, beforeId: string | null): BoardWrite => ({
    path: `/groups/${id}/place`,
    method: 'PUT',
    json: { column_id: columnId, before_id: beforeId },
  }),
  deleteSessionZero: (): BoardWrite => ({ path: '', method: 'DELETE' }),
  timer: (action: TimerAction, minutes?: number): BoardWrite => ({
    path: '/timer',
    method: 'POST',
    json: minutes === undefined ? { action } : { action, duration_s: minutes * 60 },
  }),
};

/** A step's name in the viewer's language (spec 47). */
export function moduleLabel(kind: ModuleKind): string {
  return i18n.t(`sessionZero.modules.kinds.${kind}`);
}

/** A session's name (spec 46d Decision 3): its own when the Master gave one, else the default. */
export function roundLabel(round: SessionZeroRound): string {
  return round.title ?? defaultRoundName(round.number);
}

/** The default name of the `number`th session: "Session 0", then "Session 0.5 #N". */
export function defaultRoundName(number: number): string {
  return number === 1
    ? i18n.t('sessionZero.rounds.first')
    : i18n.t('sessionZero.rounds.later', { number: number - 1 });
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

/** A column's colour as CSS (`--sz-color`), from the maps' palette (spec 46c Decision 5). */
export function columnColor(column: PostItColumn): string {
  return colorValue(column.color);
}
