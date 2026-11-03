import { groupDocumentsByMainItems, UNGROUPED_KEY } from '../../lib/documentGrouping';
import { blockDocuments, blockMaps, sessionZeroItems, type SessionZeroItem } from '../../lib/landing';
import { featureLabel, groupLabel } from '../../lib/landingText';
import i18n from '../../i18n';
import type { Document } from '../../types/document';
import type { LandingBlock, SessionZeroFeature } from '../../types/landing';
import type { RelationshipMap } from '../../types/map';
import type { SessionZeroOverview } from '../../types/sessionZero';
import type { SectionTools } from '../../hooks/useLanding';
import type { Tag } from '../../types/tag';

/** What a Section's blocks are read from; undefined while still loading. */
export interface BlockSources {
  documents?: Document[];
  maps?: RelationshipMap[];
  overview?: SessionZeroOverview;
  /** The Section's tools (spec 60), for its tool blocks. */
  tools?: SectionTools;
  tags: Tag[];
}

/** A block's items, under one sub-section each (a group, a feature) or one without a heading. */
export type BlockContent =
  | { kind: 'documents'; parts: { key: string; label: string | null; documents: Document[] }[] }
  | { kind: 'maps'; maps: RelationshipMap[] }
  | { kind: 'session_zero'; parts: { key: string; label: string | null; feature: SessionZeroFeature; items: SessionZeroItem[] }[] }
  | { kind: 'tool'; shown: boolean };

/**
 * What `block` shows from `sources`, by the same rules as the pages behind
 * it: a Documents block's Documents in its groups, the leftovers under
 * "Altri documenti" (no heading without groups); a maps block's maps; a
 * Session 0 block's features in the Master's order, with a heading only when
 * there are several. Sub-sections with nothing in them are left out.
 * Undefined while what it needs is loading.
 */
export function blockContent(block: LandingBlock, sources: BlockSources): BlockContent | undefined {
  if (block.kind === 'documents') {
    if (!sources.documents) return undefined;
    const documents = blockDocuments(sources.documents, block);
    if (block.groups.length === 0) {
      return { kind: 'documents', parts: documents.length ? [{ key: 'all', label: null, documents }] : [] };
    }
    const groups = groupDocumentsByMainItems(documents, sources.tags, block.groups.map((tagIds) => ({ tagIds })));
    return {
      kind: 'documents',
      parts: groups.map((group) => ({
        key: group.key,
        label:
          group.key === UNGROUPED_KEY
            ? i18n.t('roomLanding.otherDocuments')
            : groupLabel(
                group.tags.map((tag) => tag.id),
                sources.tags,
              ),
        documents: group.documents,
      })),
    };
  }
  if (block.kind === 'tool') {
    // A tool the viewer may not see isn't among the tools they get (spec 60 Decision 2).
    return sources.tools ? { kind: 'tool', shown: sources.tools.tools.some((tool) => tool.moduleId === block.moduleId) } : undefined;
  }
  if (block.kind === 'maps') {
    return sources.maps ? { kind: 'maps', maps: blockMaps(sources.maps, block) } : undefined;
  }
  if (!sources.overview) return undefined;
  const overview = sources.overview;
  const single = block.features.length === 1;
  return {
    kind: 'session_zero',
    parts: block.features
      .map((feature) => ({
        key: feature,
        label: single ? null : featureLabel(feature),
        feature,
        items: sessionZeroItems(overview, feature),
      }))
      .filter((part) => part.items.length > 0),
  };
}

/** Whether the block has nothing to show (spec 55 Decision 3); false while loading. */
export function isBlockEmpty(content: BlockContent | undefined): boolean {
  if (!content) return false;
  if (content.kind === 'tool') return !content.shown;
  return content.kind === 'maps' ? content.maps.length === 0 : content.parts.length === 0;
}
