/**
 * The Room's landing page (spec 55): Section cards in the Master's order. A
 * custom Section is a page of blocks; a page card opens one of the Room's
 * existing pages (Documents, Maps, Session 0, Clocks: spec 61, added on first use).
 */
export type SectionKind = 'custom' | 'page_documents' | 'page_maps' | 'page_session_zero' | 'page_clocks';

import type { ModuleKind } from './sessionZero';

/** What a block of a custom Section lists; a `tool` block holds a Session 0 step of its own (spec 60). */
export type BlockKind = 'documents' | 'maps' | 'session_zero' | 'tool';

/** The Session 0 steps a Section can hold as a tool (spec 60 Decision 1): Lines & Veils is the Room's one board. */
export type ToolKind = Exclude<ModuleKind, 'lines_veils'>;

/** Every tool, in the order the add-block popover offers them. */
export const TOOL_KINDS: ToolKind[] = ['poll', 'retro', 'stars_wishes', 'questions', 'ddi'];

/** The maps a maps block keeps; null keeps them all. */
export type BlockMapKind = 'free' | 'geographic';

/** What a Session 0 block shows, in the Master's order. */
export type SessionZeroFeature =
  | 'sessions'
  | 'retro'
  | 'lines_veils'
  | 'stars_wishes'
  | 'questions'
  | 'ddi'
  | 'polls';

/** Every Session 0 feature, in the order the features list offers them. */
export const SESSION_ZERO_FEATURES: SessionZeroFeature[] = [
  'sessions',
  'retro',
  'lines_veils',
  'stars_wishes',
  'questions',
  'ddi',
  'polls',
];

/**
 * A block: `tagIds` (all of them, AND) and `groups` (each one Tag or a
 * combination, in order) on a Documents block, `mapKind` on a maps block,
 * `features` on a Session 0 block. A null heading is named after its source.
 */
export interface LandingBlock {
  id: string;
  kind: BlockKind;
  position: number;
  heading: string | null;
  tagIds: string[];
  groups: string[][];
  mapKind: BlockMapKind | null;
  features: SessionZeroFeature[];
  /** The block opens folded (spec 60 Decision 9b). */
  collapsed: boolean;
  /** A tool block's step (spec 60); null on the other kinds. */
  moduleId: string | null;
  toolKind: ToolKind | null;
  /** Whether the Players see a tool block (only the Master sees it otherwise); null on the other kinds. */
  playersVisible: boolean | null;
}

/** A block as the editor saves it (the whole list at once); a tool block names its step. */
export type BlockInput = Omit<LandingBlock, 'id' | 'position' | 'toolKind' | 'playersVisible'>;

/**
 * A card of the landing. `title` is null on a page card the Master hasn't
 * named (its default name, in the viewer's language); `canEdit` for the Master.
 */
export interface LandingSection {
  id: string;
  kind: SectionKind;
  position: number;
  title: string | null;
  description: string;
  imageUrl: string | null;
  blocks: LandingBlock[];
  canEdit: boolean;
}

/**
 * The page cards, in their default order: a Room starts with the first three
 * (spec 55 Decision 5); the Clocks card joins on the first clock or rules
 * save (spec 61 Decision 17). A missing one is offered back.
 */
export const PAGE_SECTION_KINDS: SectionKind[] = ['page_documents', 'page_maps', 'page_session_zero', 'page_clocks'];
