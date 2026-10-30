import i18n from '../i18n';
import { colorValue } from './maps';
import type { MapColor } from '../types/map';
import type {
  ChainStep,
  DdiStep,
  LinesVeilsKind,
  ModuleKind,
  Poll,
  PollResults,
  PollVotersVisible,
  PostIt,
  PostItColumn,
  QuestionTarget,
  QuestionsStep,
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
export const MODULE_KINDS: ModuleKind[] = ['retro', 'lines_veils', 'stars_wishes', 'questions', 'ddi', 'poll'];

/** Where an answer can go (spec 47 Decision 9), in the order the Master picks from. */
export const QUESTION_TARGETS: QuestionTarget[] = ['name', 'subtitle', 'description', 'note', 'document', 'none'];

/** A Questions step's limits (Decisions 9 and 10); the backend enforces them too. */
export const MAX_QUESTIONS = 30;
export const MAX_QUESTION_LENGTH = 200;
export const MAX_HINT_LENGTH = 300;
export const MAX_DOCUMENT_QUESTIONS = 5;
export const MAX_ANSWER_LENGTH = 2000;
/** A Name answer names a Document, a Subtitle one subtitles it. */
export const MAX_NAME_ANSWER_LENGTH = 200;
export const MAX_SUBTITLE_ANSWER_LENGTH = 120;

/** A Poll step's limits (spec 53 Decision 2); the backend enforces them too. */
export const MAX_POLLS = 10;
export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 20;
export const MAX_POLL_LENGTH = 200;
export const MAX_POLL_OPTION_LENGTH = 200;
export const MAX_POLL_DESCRIPTION_LENGTH = 2000;

/** A chain nobody composed: the page as it was before spec 47 (Decision 2). */
export const DEFAULT_CHAIN: ModuleKind[] = ['retro', 'lines_veils'];

/** The steps that can carry an earlier session's content over (spec 47b Decision 2). */
export const CARRYABLE_KINDS: ModuleKind[] = ['retro', 'questions', 'ddi', 'poll'];

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

interface RawQuestions {
  tag_id: string | null;
  answers_revealed: boolean;
  players_bypass_creation_rule: boolean;
  questions: { id: string; position: number; body: string; hint: string | null; target: QuestionTarget; tag_id: string | null }[];
  answers: { question_id: string; user_id: string; body: string; note_private: boolean; updated_at: string; mine: boolean }[];
  documents: { user_id: string; question_id: string | null; document_id: string; mine: boolean }[];
  can_create: boolean;
  creatable: number;
}

interface RawModule {
  id: string;
  kind: ModuleKind;
  position: number;
  columns: RawColumn[];
  questions?: RawQuestions | null;
  ddi?: RawDdi | null;
  polls?: RawPoll[] | null;
}

interface RawPoll {
  id: string;
  body: string;
  hint: string | null;
  max_choices: number;
  master_votes: boolean;
  voters_visible: PollVotersVisible;
  results: PollResults;
  revealed: boolean;
  closed: boolean;
  has_votes: boolean;
  options: {
    id: string;
    body: string;
    description: string | null;
    count: number | null;
    voters: string[] | null;
    winner: boolean;
  }[];
  my_option_ids: string[];
  voter_count: number;
  electorate: number;
  not_voted: string[] | null;
  tally_visible: boolean;
  can_vote: boolean;
}

interface RawDdi {
  document_id: string | null;
  document_hidden: boolean;
  changed_at: string | null;
  acceptances: { user_id: string; accepted_at: string; outdated: boolean; mine: boolean }[];
  can_accept: boolean;
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

function toQuestions(raw: RawQuestions): QuestionsStep {
  return {
    tagId: raw.tag_id,
    answersRevealed: raw.answers_revealed,
    playersBypassCreationRule: raw.players_bypass_creation_rule,
    questions: raw.questions.map((question) => ({
      id: question.id,
      position: question.position,
      body: question.body,
      hint: question.hint,
      target: question.target,
      tagId: question.tag_id,
    })),
    answers: raw.answers.map((answer) => ({
      questionId: answer.question_id,
      userId: answer.user_id,
      body: answer.body,
      notePrivate: answer.note_private,
      updatedAt: answer.updated_at,
      mine: answer.mine,
    })),
    documents: raw.documents.map((link) => ({
      userId: link.user_id,
      questionId: link.question_id,
      documentId: link.document_id,
      mine: link.mine,
    })),
    canCreate: raw.can_create,
    creatable: raw.creatable,
  };
}

function toDdi(raw: RawDdi): DdiStep {
  return {
    documentId: raw.document_id,
    documentHidden: raw.document_hidden,
    changedAt: raw.changed_at,
    acceptances: raw.acceptances.map((acceptance) => ({
      userId: acceptance.user_id,
      acceptedAt: acceptance.accepted_at,
      outdated: acceptance.outdated,
      mine: acceptance.mine,
    })),
    canAccept: raw.can_accept,
  };
}

function toPoll(raw: RawPoll): Poll {
  return {
    id: raw.id,
    body: raw.body,
    hint: raw.hint,
    maxChoices: raw.max_choices,
    masterVotes: raw.master_votes,
    votersVisible: raw.voters_visible,
    results: raw.results,
    revealed: raw.revealed,
    closed: raw.closed,
    hasVotes: raw.has_votes,
    options: raw.options.map((option) => ({ ...option })),
    myOptionIds: raw.my_option_ids,
    voterCount: raw.voter_count,
    electorate: raw.electorate,
    notVoted: raw.not_voted,
    tallyVisible: raw.tally_visible,
    canVote: raw.can_vote,
  };
}

/** The page's model, from the backend's snake_case answer, showing the current step. */
export function toSessionZero(raw: RawSessionZero): SessionZero {
  const modules: SessionZeroModule[] = raw.modules.map((module) => ({
    id: module.id,
    kind: module.kind,
    position: module.position,
    columns: module.columns.map(toColumn),
    ...(module.questions ? { questions: toQuestions(module.questions) } : {}),
    ...(module.ddi ? { ddi: toDdi(module.ddi) } : {}),
    ...(module.polls ? { polls: module.polls.map(toPoll) } : {}),
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

/** A question as the Master edits it: `id` null for a new one, `hint` blank for none. */
export interface QuestionDraft {
  id: string | null;
  body: string;
  hint: string;
  target: QuestionTarget;
  tagId: string | null;
}

/**
 * What stops the Master's list from saving (Decision 9), as a translation
 * key: exactly one Name question once there are any, at most one Subtitle,
 * at most `MAX_DOCUMENT_QUESTIONS` "New Document" ones, none without text.
 */
export function questionsProblem(
  questions: QuestionDraft[],
): `sessionZero.questions.problems.${'empty' | 'oneName' | 'oneSubtitle' | 'documents'}` | null {
  const count = (target: QuestionTarget) => questions.filter((question) => question.target === target).length;
  if (questions.some((question) => !question.body.trim())) return 'sessionZero.questions.problems.empty';
  if (questions.length > 0 && count('name') !== 1) return 'sessionZero.questions.problems.oneName';
  if (count('subtitle') > 1) return 'sessionZero.questions.problems.oneSubtitle';
  if (count('document') > MAX_DOCUMENT_QUESTIONS) return 'sessionZero.questions.problems.documents';
  return null;
}

/** A poll as the Master edits it (spec 53 Decision 3); `id` null for a new one. */
export interface PollDraft {
  id: string | null;
  body: string;
  hint: string;
  maxChoices: number;
  masterVotes: boolean;
  votersVisible: PollVotersVisible;
  results: PollResults;
  options: { id: string | null; body: string; description: string }[];
}

/**
 * Spec 54 Decision 6: a poll's cards show their results side once it is
 * closed, or once a secret one is revealed.
 */
export function pollShowsResults(poll: Pick<Poll, 'closed' | 'results' | 'revealed'>): boolean {
  return poll.closed || (poll.results === 'hidden' && poll.revealed);
}

/**
 * Spec 54 Decision 5: each choice's share of all the votes cast, in whole
 * percent (0 with no votes); null for a choice whose count is hidden.
 */
export function pollShares(poll: Pick<Poll, 'options'>): Map<string, number | null> {
  const total = poll.options.reduce((sum, option) => sum + (option.count ?? 0), 0);
  return new Map(
    poll.options.map((option) => [
      option.id,
      option.count === null ? null : total > 0 ? Math.round((option.count / total) * 100) : 0,
    ]),
  );
}

/** What keeps "Edit polls" from saving (Decision 2), as a translation key; null when it can save. */
export function pollsProblem(
  polls: PollDraft[],
): `sessionZero.polls.problems.${'empty' | 'options' | 'duplicate' | 'maxChoices'}` | null {
  for (const poll of polls) {
    if (!poll.body.trim() || poll.options.some((option) => !option.body.trim())) {
      return 'sessionZero.polls.problems.empty';
    }
    if (poll.options.length < MIN_POLL_OPTIONS || poll.options.length > MAX_POLL_OPTIONS) {
      return 'sessionZero.polls.problems.options';
    }
    const keys = poll.options.map((option) => option.body.split(/\s+/).filter(Boolean).join(' ').toLowerCase());
    if (new Set(keys).size !== keys.length) return 'sessionZero.polls.problems.duplicate';
    if (poll.maxChoices < 1 || poll.maxChoices > poll.options.length) return 'sessionZero.polls.problems.maxChoices';
  }
  return null;
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
  startRound: (title: string, modules: ChainStep[]): BoardWrite => ({
    path: '/rounds',
    method: 'POST',
    json: { title: title.trim() || null, modules },
  }),
  /** Spec 47 Decision 3: a step added at the end of the open session's chain; `carry` as in spec 47b. */
  addModule: (kind: ModuleKind, carry = false): BoardWrite => ({
    path: '/modules',
    method: 'POST',
    json: { kind, carry },
  }),
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
  /** Spec 47 Decision 9: a Questions step's Tag for the main Documents (null: none). */
  setQuestionsTag: (id: string, tagId: string | null): BoardWrite => ({
    path: `/modules/${id}`,
    method: 'PATCH',
    json: { tag_id: tagId },
  }),
  /** Q7: Players create their own Documents even where the Room doesn't let them. */
  setCreationBypass: (id: string, bypass: boolean): BoardWrite => ({
    path: `/modules/${id}`,
    method: 'PATCH',
    json: { players_bypass_creation_rule: bypass },
  }),
  /** Decision 9: the whole list, in order; a question with an `id` keeps its answers. */
  setQuestions: (id: string, questions: QuestionDraft[]): BoardWrite => ({
    path: `/modules/${id}/questions`,
    method: 'PUT',
    json: {
      questions: questions.map((question) => ({
        id: question.id,
        body: question.body,
        hint: question.hint.trim() || null,
        target: question.target,
        tag_id: question.target === 'document' ? question.tagId : null,
      })),
    },
  }),
  /** Decision 10: the viewer's answers that changed; an empty one is removed. */
  saveAnswers: (id: string, answers: { questionId: string; body: string; notePrivate: boolean }[]): BoardWrite => ({
    path: `/modules/${id}/answers`,
    method: 'PUT',
    json: {
      answers: answers.map((answer) => ({
        question_id: answer.questionId,
        body: answer.body,
        note_private: answer.notePrivate,
      })),
    },
  }),
  /** Decision 10: every member reads every answer, or only their own again. */
  revealAnswers: (id: string, revealed: boolean): BoardWrite => ({
    path: `/modules/${id}/reveal`,
    method: 'PUT',
    json: { revealed },
  }),
  /** Decision 11: the Player's Document from their answers. */
  createMyDocument: (id: string): BoardWrite => ({ path: `/modules/${id}/documents`, method: 'POST' }),
  /** Decision 11: the Master's "Create everyone's Documents". */
  createEveryoneDocuments: (id: string): BoardWrite => ({ path: `/modules/${id}/documents/all`, method: 'POST' }),
  /** Spec 47 Decision 8: the Room's Document that holds the DDI (null: none yet). */
  setDdiDocument: (id: string, documentId: string | null): BoardWrite => ({
    path: `/modules/${id}/document`,
    method: 'PUT',
    json: { document_id: documentId },
  }),
  /** Decision 8a: a new Document from the DDI template, shown by the step. */
  createDdiFromTemplate: (id: string): BoardWrite => ({ path: `/modules/${id}/document/template`, method: 'POST' }),
  /** Decision 8: "I have read and accept", or taking it back. */
  acceptDdi: (id: string, accept: boolean): BoardWrite => ({
    path: `/modules/${id}/acceptance`,
    method: accept ? 'POST' : 'DELETE',
  }),
  /** Spec 53 Decision 3: the whole list, in order; an `id` keeps a poll or a choice with its votes. */
  setPolls: (id: string, polls: PollDraft[]): BoardWrite => ({
    path: `/modules/${id}/polls`,
    method: 'PUT',
    json: {
      polls: polls.map((poll) => ({
        ...(poll.id ? { id: poll.id } : {}),
        body: poll.body,
        hint: poll.hint.trim() || null,
        max_choices: poll.maxChoices,
        master_votes: poll.masterVotes,
        voters_visible: poll.votersVisible,
        results: poll.results,
        options: poll.options.map((option) => ({
          ...(option.id ? { id: option.id } : {}),
          body: option.body,
          description: option.description.trim() || null,
        })),
      })),
    },
  }),
  /** Decision 4: the viewer's whole vote on a poll; none withdraws it. */
  vote: (pollId: string, optionIds: string[]): BoardWrite => ({
    path: `/polls/${pollId}/vote`,
    method: 'PUT',
    json: { option_ids: optionIds },
  }),
  /** Decision 6: the Master closes a poll or reopens it. */
  closePoll: (pollId: string, closed: boolean): BoardWrite => ({
    path: `/polls/${pollId}/closed`,
    method: 'PUT',
    json: { closed },
  }),
  /** Decision 5: the Master shows a secret poll's tally, or hides it again. */
  revealPoll: (pollId: string, revealed: boolean): BoardWrite => ({
    path: `/polls/${pollId}/reveal`,
    method: 'PUT',
    json: { revealed },
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

/** The default name of the `number`th session: "Session 0", then "Session N". */
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
