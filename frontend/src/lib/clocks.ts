import i18n from '../i18n';
import { userDisplayName } from './members';
import type { LandingBlock } from '../types/landing';
import type { Member } from '../types/member';
import type { DocumentVisibility } from '../types/document';
import type { MapColor } from '../types/map';
import type {
  Clock,
  ClockFormValues,
  ClockGroup,
  ClockHistoryEntry,
  ClockHistoryPage,
  ClockLabel,
  ClockRules,
  ClockSettings,
  ClockState,
  ClockTemplate,
  GroupMode,
  GroupResult,
  HistoryAction,
  KindWho,
  MarkKind,
  MarkPolicy,
  OpenPolicy,
} from '../types/clock';

/** A clock's size bounds (spec 61 Decision 4c): any size in between, odd ones too. */
export const MIN_SEGMENTS = 2;
export const MAX_SEGMENTS = 16;
/** The sizes offered as shortcuts beside the stepper; only shortcuts. */
export const SIZE_SHORTCUTS = [4, 6, 8, 12];
/** Field lengths (Decision 4), mirrored from the server for the counters. */
export const MAX_NAME_LENGTH = 80;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_STAGE_LENGTH = 60;
export const MAX_CLOSING_LENGTH = 140;
export const MAX_CONSEQUENCE_LENGTH = 500;
export const MAX_LABEL_NAME_LENGTH = 30;
export const MAX_NOTE_LENGTH = 200;
export const MAX_LABELS_PER_CLOCK = 6;
export const MAX_MARK_KINDS = 6;
/** How long the toast's "Annulla" can take a mark back (Decision 9). */
export const UNDO_TOAST_MS = 5000;

// --- Wire shapes ----------------------------------------------------------------

/** A label as the server sends it. */
export interface RawLabel {
  id: string;
  name: string;
  color: MapColor;
  position: number;
  clock_count?: number | null;
}

/** A mark kind as the server sends it. */
export interface RawMarkKind {
  id: string;
  name: string;
  color: MapColor;
  who: KindWho;
  position: number;
}

/** Clock settings as the server sends and takes them. */
export interface RawSettings {
  description: string;
  segments: number;
  color: MapColor;
  stage_labels: string[];
  closing_condition: string | null;
  consequence: string | null;
  forward_only: boolean;
  mark_policy: MarkPolicy | null;
  label_ids: string[];
}

/** A template as the server sends it. */
export interface RawTemplate {
  id: string;
  name: string;
  position: number;
  settings: RawSettings;
}

/** The rules as the server sends them. */
export interface RawRules {
  open_policy: OpenPolicy;
  mark_policy: MarkPolicy;
  allow_unmark: boolean;
  labels: RawLabel[];
  mark_kinds: RawMarkKind[];
  templates: RawTemplate[];
}

/** A clock as the server sends it. */
export interface RawClock extends RawSettings {
  id: string;
  room_id: string;
  name: string;
  filled: number;
  state: ClockState;
  archived: boolean;
  group_id: string | null;
  group_position: number | null;
  decisive_label: string | null;
  document: { id: string; name: string } | null;
  segment_kinds: (string | null)[];
  visibility: DocumentVisibility;
  selective_user_ids: string[] | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  revision: number;
  locked: boolean;
  can_manage: boolean;
  can_mark: boolean;
  can_unmark: boolean;
}

/** A group as the server sends it. */
export interface RawGroup {
  id: string;
  name: string;
  mode: GroupMode;
  position: number;
  clock_ids: string[];
  ended: boolean;
  result: Record<string, unknown> | null;
  pending_ids: string[];
  revision: number;
}

/** A page of history as the server sends it. */
export interface RawHistory {
  entries: {
    id: string;
    user_id: string | null;
    action: HistoryAction;
    details: Record<string, unknown>;
    created_at: string;
  }[];
  next_before: string | null;
}

/** What a mark answers: the clock afterwards and the mark, for its undo. */
export interface RawMarkResponse {
  clock: RawClock;
  mark_id: string;
}

// --- From the wire --------------------------------------------------------------

/** A label from the wire. */
export function toLabel(raw: RawLabel): ClockLabel {
  return {
    id: raw.id,
    name: raw.name,
    color: raw.color,
    position: raw.position,
    clockCount: raw.clock_count ?? null,
  };
}

/** A mark kind from the wire. */
export function toMarkKind(raw: RawMarkKind): MarkKind {
  return { id: raw.id, name: raw.name, color: raw.color, who: raw.who, position: raw.position };
}

/** Settings from the wire. */
export function toSettings(raw: RawSettings): ClockSettings {
  return {
    description: raw.description,
    segments: raw.segments,
    color: raw.color,
    stageLabels: raw.stage_labels,
    closingCondition: raw.closing_condition,
    consequence: raw.consequence,
    forwardOnly: raw.forward_only,
    markPolicy: raw.mark_policy,
    labelIds: raw.label_ids,
  };
}

/** The rules from the wire. */
export function toRules(raw: RawRules): ClockRules {
  return {
    openPolicy: raw.open_policy,
    markPolicy: raw.mark_policy,
    allowUnmark: raw.allow_unmark,
    labels: raw.labels.map(toLabel),
    markKinds: raw.mark_kinds.map(toMarkKind),
    templates: raw.templates.map((template) => ({
      id: template.id,
      name: template.name,
      position: template.position,
      settings: toSettings(template.settings),
    })),
  };
}

/** A clock from the wire. */
export function toClock(raw: RawClock): Clock {
  return {
    ...toSettings(raw),
    id: raw.id,
    roomId: raw.room_id,
    name: raw.name,
    filled: raw.filled,
    state: raw.state,
    archived: raw.archived,
    groupId: raw.group_id,
    groupPosition: raw.group_position,
    decisiveLabel: raw.decisive_label,
    document: raw.document,
    segmentKinds: raw.segment_kinds,
    visibility: raw.visibility,
    selectiveUserIds: raw.selective_user_ids,
    createdBy: raw.created_by,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    revision: raw.revision,
    locked: raw.locked,
    canManage: raw.can_manage,
    canMark: raw.can_mark,
    canUnmark: raw.can_unmark,
  };
}

/** A group from the wire. */
export function toGroup(raw: RawGroup): ClockGroup {
  return {
    id: raw.id,
    name: raw.name,
    mode: raw.mode,
    position: raw.position,
    clockIds: raw.clock_ids,
    ended: raw.ended,
    result: toGroupResult(raw.result),
    pendingIds: raw.pending_ids,
    revision: raw.revision,
  };
}

/** A group's result from the wire: `winner_ids` for a race, `outcomes` for a turn. */
function toGroupResult(raw: Record<string, unknown> | null): GroupResult | null {
  if (!raw) return null;
  if ('winner_ids' in raw) {
    return { kind: 'race', winnerIds: raw.winner_ids as string[], tie: raw.tie === true };
  }
  const outcomes = (raw.outcomes ?? []) as { clock_id: string; label: string | null }[];
  return { kind: 'turn', outcomes: outcomes.map((outcome) => ({ clockId: outcome.clock_id, label: outcome.label })) };
}

/** A page of history from the wire. */
export function toHistory(raw: RawHistory): ClockHistoryPage {
  return {
    entries: raw.entries.map(
      (entry): ClockHistoryEntry => ({
        id: entry.id,
        userId: entry.user_id,
        action: entry.action,
        details: entry.details,
        createdAt: entry.created_at,
      }),
    ),
    nextBefore: raw.next_before,
  };
}

// --- To the wire ----------------------------------------------------------------

/** Settings to the wire; empty texts go as null, trailing empty stages are dropped. */
export function toSettingsBody(settings: ClockSettings): RawSettings {
  const stages = [...settings.stageLabels];
  while (stages.length > 0 && !stages[stages.length - 1].trim()) stages.pop();
  return {
    description: settings.description,
    segments: settings.segments,
    color: settings.color,
    stage_labels: stages.slice(0, settings.segments),
    closing_condition: settings.closingCondition?.trim() || null,
    consequence: settings.consequence?.trim() || null,
    forward_only: settings.forwardOnly,
    mark_policy: settings.markPolicy,
    label_ids: settings.labelIds,
  };
}

/** A new clock's body (`POST /clocks`). A Player never sends a consequence. */
export function toCreateBody(values: ClockFormValues) {
  return {
    ...toSettingsBody(values),
    name: values.name.trim(),
    document_id: values.documentId,
    visibility: values.visibility,
    selective_user_ids: values.visibility === 'selective' ? values.selectiveUserIds : [],
  };
}

/** The fields a clearable setting goes back to null with (`clear` on `PATCH`). */
const CLEARABLE = {
  closing_condition: 'closingCondition',
  consequence: 'consequence',
  mark_policy: 'markPolicy',
} as const;

/**
 * An edit's body (`PATCH /clocks/{id}`): every field of the form, with the
 * revision it was loaded at (the server answers 412 when another edit came
 * first, spec 42 Decision 7), and the nullable fields now empty in `clear`.
 */
export function toUpdateBody(values: ClockFormValues, baseRevision: number) {
  const settings = toSettingsBody(values);
  const clear: string[] = [];
  const body: Record<string, unknown> = {
    base_revision: baseRevision,
    name: values.name.trim(),
    description: settings.description,
    segments: settings.segments,
    color: settings.color,
    stage_labels: settings.stage_labels,
    forward_only: settings.forward_only,
    label_ids: settings.label_ids,
    visibility: values.visibility,
    selective_user_ids: values.visibility === 'selective' ? values.selectiveUserIds : [],
  };
  for (const key of Object.keys(CLEARABLE) as (keyof typeof CLEARABLE)[]) {
    const value = settings[key];
    if (value === null) clear.push(key);
    else body[key] = value;
  }
  if (values.documentId) body.document_id = values.documentId;
  else clear.push('document_id');
  body.clear = clear;
  return body;
}

// --- Templates and presets ------------------------------------------------------

/** A built-in template (Decision 3): fills the form, names come from the strings. */
export interface BuiltInTemplate {
  key: 'progress' | 'danger' | 'countdown' | 'project' | 'faction' | 'tugOfWar' | 'empty';
  segments: number;
  color: MapColor;
  /** How many stage labels it starts with (a countdown's). */
  stages: number;
  /** A faction is the Master's own. */
  masterOnly: boolean;
}

/** The built-in templates, in the dialog's order (Decision 3). */
export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  { key: 'progress', segments: 6, color: 'green', stages: 0, masterOnly: false },
  { key: 'danger', segments: 4, color: 'red', stages: 0, masterOnly: false },
  { key: 'countdown', segments: 6, color: 'orange', stages: 6, masterOnly: false },
  { key: 'project', segments: 8, color: 'blue', stages: 0, masterOnly: false },
  { key: 'faction', segments: 6, color: 'purple', stages: 0, masterOnly: true },
  { key: 'tugOfWar', segments: 6, color: 'gold', stages: 0, masterOnly: false },
  { key: 'empty', segments: 4, color: 'default', stages: 0, masterOnly: false },
];

/** Empty settings: the "Vuoto" template's. */
export function emptySettings(): ClockSettings {
  return {
    description: '',
    segments: 4,
    color: 'default',
    stageLabels: [],
    closingCondition: null,
    consequence: null,
    forwardOnly: false,
    markPolicy: null,
    labelIds: [],
  };
}

/** A built-in template's settings; a countdown's stages are numbered in the viewer's language. */
export function builtInSettings(template: BuiltInTemplate): ClockSettings {
  return {
    ...emptySettings(),
    segments: template.segments,
    color: template.color,
    stageLabels: Array.from({ length: template.stages }, (_, index) =>
      i18n.t('clocks.dialog.stageDefault', { number: index + 1 }),
    ),
  };
}

/** A Room template's settings, for the form (labels the Room has since deleted are dropped). */
export function templateSettings(template: ClockTemplate, labels: ClockLabel[]): ClockSettings {
  const known = new Set(labels.map((label) => label.id));
  return { ...template.settings, labelIds: template.settings.labelIds.filter((id) => known.has(id)) };
}

/** A rule preset (Decision 2): only the three policies, never labels or kinds. */
export interface RulesPreset {
  key: 'simple' | 'wholeTable' | 'noReturn';
  openPolicy: OpenPolicy;
  markPolicy: MarkPolicy;
  allowUnmark: boolean;
}

/** The presets, in the rules dialog's order; "Semplice" is every Room's default. */
export const RULES_PRESETS: RulesPreset[] = [
  { key: 'simple', openPolicy: 'master', markPolicy: 'master', allowUnmark: true },
  { key: 'wholeTable', openPolicy: 'everyone', markPolicy: 'everyone', allowUnmark: true },
  { key: 'noReturn', openPolicy: 'propose', markPolicy: 'everyone', allowUnmark: false },
];

/** The preset these policies match, if any. */
export function matchingPreset(
  rules: Pick<ClockRules, 'openPolicy' | 'markPolicy' | 'allowUnmark'>,
): RulesPreset | null {
  return (
    RULES_PRESETS.find(
      (preset) =>
        preset.openPolicy === rules.openPolicy &&
        preset.markPolicy === rules.markPolicy &&
        preset.allowUnmark === rules.allowUnmark,
    ) ?? null
  );
}

// --- Reading clocks ---------------------------------------------------------------

/** The mark kinds this member may use (Decision 1); the server checks it again. */
export function usableKinds(kinds: MarkKind[], isMaster: boolean): MarkKind[] {
  return kinds.filter(
    (kind) => kind.who === 'everyone' || (kind.who === 'master') === isMaster,
  );
}

/** Whether a member may open (or propose) clocks under these rules (Decision 1, D-13). */
export function canCreateClocks(
  rules: Pick<ClockRules, 'openPolicy'>,
  isMaster: boolean,
  playersCreate: boolean,
): boolean {
  return isMaster || (rules.openPolicy !== 'master' && playersCreate);
}

/** A clock as its face's label reads it: "Allarme: 4 su 8, aperto, 2 Successo e 2 Shock". */
export function clockSummary(clock: Clock, kinds: MarkKind[]): string {
  const counts = new Map<string | null, number>();
  for (const kind of clock.segmentKinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const parts = kinds
    .filter((kind) => counts.has(kind.id))
    .map((kind) => i18n.t('clocks.face.kindCount', { number: counts.get(kind.id), name: kind.name }));
  const base = i18n.t('clocks.face.summary', {
    name: clock.name,
    filled: clock.filled,
    segments: clock.segments,
    state: stateLabel(clock),
  });
  return parts.length > 0 ? i18n.t('clocks.face.withKinds', { base, kinds: parts.join(', ') }) : base;
}

/** A clock's state in words; an archived clock says so first. */
export function stateLabel(clock: Pick<Clock, 'state' | 'archived' | 'locked'>): string {
  if (clock.archived) return i18n.t('clocks.state.archived');
  if (clock.locked && clock.state === 'open') return i18n.t('clocks.state.locked');
  return i18n.t(`clocks.state.${clock.state}`);
}

/** Whether a clock still takes marks at all: open, not archived, not waiting its turn. */
export function isMarkable(clock: Clock): boolean {
  return clock.canMark && clock.state === 'open' && !clock.archived && !clock.locked;
}

/** Whether a clock can be emptied by one now (closed ones reopen, Decision 5). */
export function isUnmarkable(clock: Clock): boolean {
  return (
    clock.canUnmark &&
    clock.filled > 0 &&
    (clock.state === 'open' || clock.state === 'closed') &&
    !clock.archived &&
    !clock.locked
  );
}

/**
 * What a click on wedge `index` (0-based) asks (Decision 7): fill up to it,
 * or empty the last filled one when it is the one clicked. Zero when it asks
 * nothing this member may do.
 */
export function wedgeDelta(clock: Clock, index: number): number {
  if (index === clock.filled - 1) return isUnmarkable(clock) ? -1 : 0;
  if (index >= clock.filled) return isMarkable(clock) ? index + 1 - clock.filled : 0;
  return isUnmarkable(clock) ? index + 1 - clock.filled : 0;
}

/**
 * The Clocks page's lists (Decision 17): clocks in play outside groups,
 * proposals, closed and lapsed ones, archived ones. Each keeps the page's order.
 */
export function splitClocks(clocks: Clock[]) {
  const live = clocks.filter((clock) => !clock.archived);
  return {
    open: live.filter((clock) => clock.state === 'open'),
    proposed: live.filter((clock) => clock.state === 'proposed'),
    finished: live.filter((clock) => clock.state === 'closed' || clock.state === 'lapsed'),
    archived: clocks.filter((clock) => clock.archived),
  };
}

// --- The face ------------------------------------------------------------------

/**
 * The SVG path of wedge `index` of `segments`, clockwise from twelve o'clock,
 * on a circle of radius `r` centred at (`r`, `r`). Wedges are separated by
 * the stroke the face draws in the background colour (Decision 24).
 */
export function wedgePath(index: number, segments: number, r: number): string {
  const start = (index / segments) * 2 * Math.PI - Math.PI / 2;
  const end = ((index + 1) / segments) * 2 * Math.PI - Math.PI / 2;
  const point = (angle: number) =>
    `${(r + r * Math.cos(angle)).toFixed(3)} ${(r + r * Math.sin(angle)).toFixed(3)}`;
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${r} ${r} L ${point(start)} A ${r} ${r} 0 ${large} 1 ${point(end)} Z`;
}

/** The colour of each filled wedge: its mark kind's, or the clock's for a plain mark or a deleted kind's. */
export function wedgeColors(clock: Clock, kinds: MarkKind[]): MapColor[] {
  return clock.segmentKinds.map((kindId) => {
    if (kindId === null) return clock.color;
    return kinds.find((kind) => kind.id === kindId)?.color ?? 'silver';
  });
}

// --- History -----------------------------------------------------------------

/** Reads a string through the shared instance; some keys are built at run time. */
function translate(key: string, options?: Record<string, unknown>): string {
  return (i18n.t as (key: string, options?: Record<string, unknown>) => string)(key, options);
}

/** One line in words: who, what, how much, where the clock stood, the note. */
export function historyLine(entry: ClockHistoryEntry, kinds: MarkKind[], members: Member[]): string {
  const i18nT = translate;
  const member = members.find((other) => other.userId === entry.userId);
  const who = member ? userDisplayName(member) : i18nT('clocks.history.formerMember');
  const details = entry.details;
  const parts = [who];
  if (entry.action === 'marked' || entry.action === 'undone') {
    const delta = Number(details.delta ?? 0);
    const kind = kinds.find((other) => other.id === details.kind_id);
    const signed = delta > 0 ? `+${delta}` : String(delta);
    parts.push(
      entry.action === 'undone'
        ? i18nT('clocks.history.undone', { delta: signed })
        : kind
          ? `${kind.name} ${signed}`
          : signed,
    );
    if (details.filled !== undefined) {
      parts.push(i18nT('clocks.card.progress', { filled: details.filled, segments: details.segments }));
    }
    if (typeof details.note === 'string' && details.note) parts.push(details.note);
  } else if (entry.action === 'edited') {
    const fields = Array.isArray(details.fields) ? (details.fields as string[]) : [];
    parts.push(
      i18nT('clocks.history.edited', {
        fields: fields.map((field) => i18nT(`clocks.history.fields.${field}`)).join(', '),
      }),
    );
  } else {
    parts.push(i18nT(`clocks.history.actions.${entry.action}`));
  }
  return parts.join(' · ');
}

// --- Groups ----------------------------------------------------------------------

/** A group holds at most this many clocks (spec 61 Decision 31). */
export const MAX_CLOCKS_PER_GROUP = 12;
/** A turn group's decisive label (Decision 11). */
export const MAX_DECISIVE_LABEL_LENGTH = 30;
/** The modes in the order the group dialog offers them. */
export const GROUP_MODES: GroupMode[] = ['free', 'race', 'turn', 'sequence'];

/** The clocks of `group` the viewer sees, in the group's order, archived ones out. */
export function groupClocks(group: ClockGroup, clocks: Clock[]): Clock[] {
  return group.clockIds.flatMap((id) => clocks.filter((clock) => clock.id === id && !clock.archived));
}

function names(ids: string[], clocks: Clock[]): string {
  return ids
    .flatMap((id) => clocks.filter((clock) => clock.id === id))
    .map((clock) => translate('clocks.groups.quoted', { name: clock.name }))
    .join(', ');
}

/** An ended group's result (Decision 12): "Vinto: «Fuga»", "Pari: «Fuga», «Accerchiati»", "Svolta: Bomba disinnescata!". */
export function groupResultLine(result: GroupResult | null, clocks: Clock[]): string | null {
  if (!result) return null;
  if (result.kind === 'race') {
    return translate(result.tie ? 'clocks.groups.resultTie' : 'clocks.groups.resultWon', {
      names: names(result.winnerIds, clocks),
    });
  }
  const labels = result.outcomes.map((outcome) => outcome.label ?? names([outcome.clockId], clocks));
  return translate('clocks.groups.resultTurn', { labels: labels.join(', ') });
}

/** What a group asks of the Master now (Decision 11); none once it ended or for a Player. */
export type GroupPrompt =
  | { kind: 'race'; clocks: Clock[] }
  | { kind: 'turn'; clocks: Clock[] }
  | { kind: 'reveal'; clock: Clock };

/**
 * A race whose clock closed ("Conferma"), a turn whose decisive clock closed
 * ("Termina la svolta"), or a sequence whose next clock, now open to marks,
 * is still hidden from the Players ("Rivelare «…»?"). Nothing changes on
 * its own: the Master answers.
 */
export function groupPrompt(group: ClockGroup, clocks: Clock[]): GroupPrompt | null {
  if (group.ended) return null;
  const pending = group.pendingIds.flatMap((id) => clocks.filter((clock) => clock.id === id));
  if (group.mode === 'race' || group.mode === 'turn') {
    return pending.length > 0 ? { kind: group.mode, clocks: pending } : null;
  }
  if (group.mode !== 'sequence') return null;
  const ordered = groupClocks(group, clocks);
  const next = ordered.findIndex((clock) => clock.state === 'open');
  if (next < 1 || ordered[next].visibility === 'room') return null;
  return ordered[next - 1].state === 'closed' ? { kind: 'reveal', clock: ordered[next] } : null;
}

// --- Clocks blocks -----------------------------------------------------------------

/**
 * What a Clocks block shows (spec 61 Decision 18): with "Tutti i clock
 * aperti", every open clock in the page's order; else its chips in order, a
 * group's chip standing for its clocks. Archived and proposed clocks are
 * left out, and a clock named twice shows once.
 */
export function blockClocks(
  block: Pick<LandingBlock, 'clockChips' | 'allClocks'>,
  clocks: Clock[],
  groups: ClockGroup[],
): Clock[] {
  const live = clocks.filter((clock) => !clock.archived && clock.state !== 'proposed');
  if (block.allClocks) return live.filter((clock) => clock.state === 'open');
  const ids = block.clockChips.flatMap((chip) =>
    chip.clockId !== null
      ? [chip.clockId]
      : groups.filter((group) => group.id === chip.groupId).flatMap((group) => group.clockIds),
  );
  return [...new Set(ids)].flatMap((id) => live.filter((clock) => clock.id === id));
}
