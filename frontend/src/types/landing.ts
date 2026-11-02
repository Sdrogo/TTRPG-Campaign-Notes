/**
 * The Room's landing page (spec 55): Section cards in the Master's order. A
 * custom Section is a page of blocks; a page card opens one of the Room's
 * existing pages (Documents, Maps, Session 0).
 */
export type SectionKind = 'custom' | 'page_documents' | 'page_maps' | 'page_session_zero';

/** What a block of a custom Section lists. */
export type BlockKind = 'documents' | 'maps' | 'session_zero';

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
}

/** A block as the editor saves it (the whole list at once). */
export type BlockInput = Omit<LandingBlock, 'id' | 'position'>;

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

/** The page cards a Room starts with, in their default order (spec 55 Decision 5). */
export const PAGE_SECTION_KINDS: SectionKind[] = ['page_documents', 'page_maps', 'page_session_zero'];
