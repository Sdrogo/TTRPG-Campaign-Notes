import type { DocumentVisibility } from './document';
import type { MapColor } from './map';

/** Who opens a clock in this Room (spec 61 Decision 1). */
export type OpenPolicy = 'master' | 'everyone' | 'propose';

/** Who marks a clock: the Room's rule, or one clock's own (Decisions 1 and 6). */
export type MarkPolicy = 'master' | 'master_and_creator' | 'everyone';

/** Who may use a mark kind (Decision 1). */
export type KindWho = 'master' | 'players' | 'everyone';

/** A clock's state (Decision 5); archiving is apart from it. */
export type ClockState = 'proposed' | 'open' | 'closed' | 'lapsed';

/** How a group's clocks play together (Decision 11). */
export type GroupMode = 'free' | 'race' | 'turn' | 'sequence';

/** A free label of the Room, created by the Master (Decision 1). */
export interface ClockLabel {
  id: string;
  name: string;
  color: MapColor;
  position: number;
  /** How many clocks carry it; sent to the Master only (the delete confirmation says it). */
  clockCount: number | null;
}

/** What a mark is made of in this game (Decision 1), with its colour. */
export interface MarkKind {
  id: string;
  name: string;
  color: MapColor;
  who: KindWho;
  position: number;
}

/** What a clock is besides its name: the form a template fills (Decision 3). */
export interface ClockSettings {
  description: string;
  segments: number;
  color: MapColor;
  stageLabels: string[];
  closingCondition: string | null;
  /** Master only: null for a Player. */
  consequence: string | null;
  forwardOnly: boolean;
  /** Null follows the Room's rule. */
  markPolicy: MarkPolicy | null;
  labelIds: string[];
}

/** A template of the Room (Decision 3). */
export interface ClockTemplate {
  id: string;
  name: string;
  position: number;
  settings: ClockSettings;
}

/** The Room's clock setup (Decision 1): rules, labels, mark kinds, templates. */
export interface ClockRules {
  openPolicy: OpenPolicy;
  markPolicy: MarkPolicy;
  allowUnmark: boolean;
  labels: ClockLabel[];
  markKinds: MarkKind[];
  templates: ClockTemplate[];
}

/** A clock as the viewer sees it. Permission flags come from the server. */
export interface Clock extends ClockSettings {
  id: string;
  roomId: string;
  name: string;
  filled: number;
  state: ClockState;
  archived: boolean;
  groupId: string | null;
  groupPosition: number | null;
  decisiveLabel: string | null;
  /** The linked Document, when the viewer sees it too (Decision 19). */
  document: { id: string; name: string } | null;
  /** Each filled segment's mark kind, in order; null is the clock's own colour. */
  segmentKinds: (string | null)[];
  visibility: DocumentVisibility;
  /** Sent only to who may manage the clock. */
  selectiveUserIds: string[] | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  /** A sequence clock waiting for the one before it (Decision 11). */
  locked: boolean;
  canManage: boolean;
  canMark: boolean;
  canUnmark: boolean;
}

/** A group as the viewer sees it: only the clocks they see. */
export interface ClockGroup {
  id: string;
  name: string;
  mode: GroupMode;
  position: number;
  clockIds: string[];
  ended: boolean;
  result: Record<string, unknown> | null;
  /** Clocks whose close waits for the Master's word (race, turn, sequence). */
  pendingIds: string[];
  revision: number;
}

/** What a history line records (Decision 10). */
export type HistoryAction =
  | 'created'
  | 'proposed'
  | 'opened'
  | 'marked'
  | 'undone'
  | 'closed'
  | 'reopened'
  | 'lapsed'
  | 'archived'
  | 'restored'
  | 'edited';

/** One line of a clock's history. */
export interface ClockHistoryEntry {
  id: string;
  userId: string | null;
  action: HistoryAction;
  details: Record<string, unknown>;
  createdAt: string;
}

/** A page of history, newest first; `nextBefore` reads the page after. */
export interface ClockHistoryPage {
  entries: ClockHistoryEntry[];
  nextBefore: string | null;
}

/** The clock dialog's values (Decision 4). */
export interface ClockFormValues extends ClockSettings {
  name: string;
  documentId: string | null;
  visibility: DocumentVisibility;
  selectiveUserIds: string[];
}
