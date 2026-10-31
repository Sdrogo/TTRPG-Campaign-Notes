// Landing (spec 55) models in their camelCase shape, built from the wire
// fixtures through the same converters the hooks use.
import { toSection, type RawSection } from '../lib/landing';
import { toMap, type RawMap } from '../lib/maps';
import { toSessionZeroOverview, type RawSessionZeroOverview } from '../lib/sessionZeroOverview';
import type { Document } from '../types/document';
import type { LandingBlock, LandingSection } from '../types/landing';
import type { RelationshipMap } from '../types/map';
import type { SessionZeroOverview } from '../types/sessionZero';
import type { Tag } from '../types/tag';
import { rawBlock, rawMap, rawSection, rawSessionZeroOverview } from './fixtures';

export function section(overrides: Record<string, unknown> = {}): LandingSection {
  return toSection(rawSection(overrides) as RawSection);
}

export function block(overrides: Record<string, unknown> = {}): LandingBlock {
  return section({ blocks: [rawBlock(overrides)] }).blocks[0];
}

export function overview(overrides: Record<string, unknown> = {}): SessionZeroOverview {
  return toSessionZeroOverview(rawSessionZeroOverview(overrides) as RawSessionZeroOverview);
}

export function map(overrides: Record<string, unknown> = {}): RelationshipMap {
  return toMap(rawMap(overrides) as RawMap);
}

export function tag(id: string, name: string, mainPosition: number | null = null): Tag {
  return { id, name, category: null, mainPosition };
}

export function doc(id: string, name: string, tagIds: string[], overrides: Partial<Document> = {}): Document {
  return {
    id,
    roomId: 'room-1',
    name,
    subtitle: null,
    description: '',
    visibility: 'room',
    images: [],
    tagIds,
    ownerIds: [],
    selectiveUserIds: [],
    playedBy: null,
    notes: [],
    ...overrides,
  } as Document;
}
