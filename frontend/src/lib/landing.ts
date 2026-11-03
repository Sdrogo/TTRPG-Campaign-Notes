import { currentLanguage } from '../i18n';
import { filterDocumentsByTags } from './documentFilters';
import { sortDocuments } from './documentSorting';
import type { Document } from '../types/document';
import type {
  BlockInput,
  BlockKind,
  BlockMapKind,
  LandingBlock,
  LandingSection,
  SectionKind,
  SessionZeroFeature,
  ToolKind,
} from '../types/landing';
import { PAGE_SECTION_KINDS } from '../types/landing';
import type { RelationshipMap } from '../types/map';
import type { ModuleKind, OverviewRound, OverviewStep, Poll, SessionZeroOverview } from '../types/sessionZero';

/** A block on the wire. */
export interface RawBlock {
  id: string;
  kind: BlockKind;
  position: number;
  heading: string | null;
  tag_ids: string[];
  groups: string[][];
  map_kind: BlockMapKind | null;
  features: SessionZeroFeature[];
  collapsed?: boolean;
  module_id?: string | null;
  tool_kind?: ToolKind | null;
  players_visible?: boolean | null;
}

/** A Section on the wire (`GET /rooms/{id}/sections`). */
export interface RawSection {
  id: string;
  kind: SectionKind;
  position: number;
  title: string | null;
  description: string;
  image_url: string | null;
  blocks: RawBlock[];
  can_edit: boolean;
}

/** A Section from the backend's snake_case answer. */
export function toSection(raw: RawSection): LandingSection {
  return {
    id: raw.id,
    kind: raw.kind,
    position: raw.position,
    title: raw.title,
    description: raw.description,
    imageUrl: raw.image_url,
    canEdit: raw.can_edit,
    blocks: raw.blocks.map((block) => ({
      id: block.id,
      kind: block.kind,
      position: block.position,
      heading: block.heading,
      tagIds: block.tag_ids,
      groups: block.groups,
      mapKind: block.map_kind,
      features: block.features,
      collapsed: block.collapsed ?? false,
      moduleId: block.module_id ?? null,
      toolKind: block.tool_kind ?? null,
      playersVisible: block.players_visible ?? null,
    })),
  };
}

/** A block as `PUT .../blocks` takes it. */
export function toBlockBody(block: BlockInput) {
  return {
    kind: block.kind,
    heading: block.heading,
    tag_ids: block.tagIds,
    groups: block.groups,
    map_kind: block.mapKind,
    features: block.features,
    module_id: block.moduleId,
    collapsed: block.collapsed,
  };
}

/** What a saved block is sent back as, to save the list again with one change. */
export function blockInput(block: LandingBlock): BlockInput {
  return {
    kind: block.kind,
    heading: block.heading,
    tagIds: block.tagIds,
    groups: block.groups,
    mapKind: block.mapKind,
    features: block.features,
    moduleId: block.moduleId,
    collapsed: block.collapsed,
  };
}

/** Where a Section card leads: a custom Section's page, or the page a page card opens. */
export function sectionHref(roomId: string, section: Pick<LandingSection, 'id' | 'kind'>): string {
  switch (section.kind) {
    case 'page_documents':
      return `/rooms/${roomId}/documents`;
    case 'page_maps':
      return `/rooms/${roomId}/maps`;
    case 'page_session_zero':
      return `/rooms/${roomId}/session-zero`;
    default:
      return `/rooms/${roomId}/sections/${section.id}`;
  }
}

/** The landing page's address. */
export function landingHref(roomId: string): string {
  return `/rooms/${roomId}`;
}

/** The DOM id of a block on its Section page, the Index's scroll target. */
export function blockAnchor(blockId: string): string {
  return `block-${blockId}`;
}

/** The window event the Index fires before scrolling to a block, so a folded block opens (spec 60 Decision 9). */
export const REVEAL_BLOCK_EVENT = 'room-landing:reveal-block';

/** A Documents block's Documents: every Tag of the block (AND), by name. */
export function blockDocuments(documents: Document[], block: LandingBlock): Document[] {
  return sortDocuments(filterDocumentsByTags(documents, block.tagIds), 'name-asc');
}

/** A maps block's maps: of its kind when it has one, by name. */
export function blockMaps(maps: RelationshipMap[], block: LandingBlock): RelationshipMap[] {
  const language = currentLanguage();
  return maps
    .filter((map) => !block.mapKind || map.kind === block.mapKind)
    .sort((a, b) => a.name.localeCompare(b.name, language, { sensitivity: 'base' }));
}

/** The step kind a Session 0 feature lists; null for the sessions, Lines & Veils and polls. */
const STEP_FEATURES: Partial<Record<SessionZeroFeature, ModuleKind>> = {
  retro: 'retro',
  stars_wishes: 'stars_wishes',
  questions: 'questions',
  ddi: 'ddi',
};

/** One card of a Session 0 block (spec 55 Decision 8). */
export type SessionZeroItem =
  | { kind: 'session'; key: string; round: OverviewRound }
  | { kind: 'step'; key: string; round: OverviewRound; step: OverviewStep }
  | { kind: 'linesVeils'; key: string; counts: SessionZeroOverview['linesVeils'] }
  | { kind: 'poll'; key: string; round: OverviewRound; step: OverviewStep; poll: Poll };

/**
 * What a Session 0 feature lists, newest session first: the sessions, each
 * step of its kind the viewer reached, Lines & Veils as one card, or one
 * card per poll. Nothing before the Session 0 starts.
 */
export function sessionZeroItems(overview: SessionZeroOverview, feature: SessionZeroFeature): SessionZeroItem[] {
  if (!overview.started) return [];
  if (feature === 'sessions') {
    return overview.rounds.map((round) => ({ kind: 'session', key: round.id, round }));
  }
  if (feature === 'lines_veils') {
    return [{ kind: 'linesVeils', key: 'lines-veils', counts: overview.linesVeils }];
  }
  if (feature === 'polls') {
    return overview.rounds.flatMap((round) =>
      round.steps
        .filter((step) => step.kind === 'poll')
        .flatMap((step) => (step.polls ?? []).map((poll) => ({ kind: 'poll' as const, key: poll.id, round, step, poll }))),
    );
  }
  const kind = STEP_FEATURES[feature];
  return overview.rounds.flatMap((round) =>
    round.steps.filter((step) => step.kind === kind).map((step) => ({ kind: 'step' as const, key: step.id, round, step })),
  );
}

/** The Session 0 page opened on a session, and on one of its steps. */
export function sessionZeroHref(roomId: string, roundId?: string, stepId?: string): string {
  const params = new URLSearchParams();
  if (roundId) params.set('session', roundId);
  if (stepId) params.set('step', stepId);
  const query = params.toString();
  return `/rooms/${roomId}/session-zero${query ? `?${query}` : ''}`;
}

/** The page cards (Documenti, Mappe, Sessione 0) the Master deleted, which "Nuova sezione" offers back. */
export function missingPageKinds(sections: LandingSection[]): SectionKind[] {
  return PAGE_SECTION_KINDS.filter((kind) => !sections.some((section) => section.kind === kind));
}
