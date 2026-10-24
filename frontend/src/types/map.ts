import type { DocumentVisibility } from './document';
import type { StoredImage } from './image';

/** The theme colors a card, a label or a group takes (spec 28 Decision 8). */
export type MapColor =
  | 'default'
  | 'red'
  | 'green'
  | 'purple'
  | 'blue'
  | 'gold'
  | 'orange'
  | 'midnight'
  | 'silver'
  | 'champagne'
  | 'rose'
  | 'pink'
  | 'cobalt'
  | 'violet'
  | 'emerald'
  | 'brown'
  | 'lime';

/** How large a text card's text is (Decision 6). */
export type CardSize = 'normal' | 'large' | 'title';

/** Which way an arrow points (Decision 5): one way, both ways or neither. */
export type ArrowDirection = 'forward' | 'both' | 'none';

/**
 * A free board of cards (spec 28) or a geographic map of areas and pins on a
 * plane (spec 38). A map's kind never changes.
 */
export type MapKind = 'free' | 'geographic';

/** A map as the Room's list of maps shows it (spec 28 Decision 1). */
export interface RelationshipMap {
  id: string;
  roomId: string;
  name: string;
  description: string;
  kind: MapKind;
  /** A geographic map's plane, in map units; null on a free map. */
  planeWidth: number | null;
  planeHeight: number | null;
  visibility: DocumentVisibility;
  /** Sent only to who may manage the map (its creator and the Master). */
  selectiveUserIds: string[] | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** The Documents on the map the viewer sees. */
  documentCount: number;
  /** Spec 42: every member who sees the map edits its board. */
  playersCanEdit: boolean;
  /** Counts the map's writes; a board save sends the one it started from (spec 42 Decision 7). */
  revision: number;
  /** May change the board: its managers, or anyone while `playersCanEdit`. */
  canEdit: boolean;
  /** May change its settings or delete it: its creator and the Master. */
  canManage: boolean;
}

/** What a Document card shows of its Document. */
export interface MapDocument {
  id: string;
  name: string;
  subtitle: string | null;
  image: StoredImage | null;
  tagIds: string[];
}

/** A framed box holding cards (Decision 7); `x`, `y` is its top left corner. */
export interface MapGroup {
  id: string;
  title: string | null;
  color: MapColor;
  struck: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A card: a Document (`documentId`) or a text card (`text`). In a group, `x`
 * and `y` are relative to the group's corner, so the cards move with it.
 */
export interface MapCard {
  id: string;
  documentId: string | null;
  text: string | null;
  groupId: string | null;
  /** A Document card's caption on this map, replacing its subtitle. */
  caption: string | null;
  /**
   * The Document image this card shows, on this map only; null for the
   * Document's favorite, which the card then follows.
   */
  imageId: string | null;
  size: CardSize;
  masterOnly: boolean;
  color: MapColor;
  struck: boolean;
  x: number;
  y: number;
  /** The Document's look, on a Document card. */
  document: MapDocument | null;
}

/** One end of an arrow: a card or a group. */
export interface ArrowEnd {
  cardId: string | null;
  groupId: string | null;
}

/**
 * An arrow between two ends. `label` is the only label of a one-way arrow or a
 * line, the one pointing at `to` on a two-way arrow; `reverseLabel` the one
 * pointing at `from`. The positions are where each label was dragged to along
 * the arrow, from 0 (at `from`) to 1 (at `to`); null leaves it to the board.
 */
export interface MapArrow {
  id: string;
  from: ArrowEnd;
  to: ArrowEnd;
  direction: ArrowDirection;
  label: string | null;
  reverseLabel: string | null;
  labelPosition: number | null;
  reverseLabelPosition: number | null;
  /** How far a dragged label sits to the side of the arrow, in board pixels. */
  labelOffset: number | null;
  reverseLabelOffset: number | null;
  color: MapColor;
  masterOnly: boolean;
}

/** Everything on a map the viewer sees. */
export interface Board {
  groups: MapGroup[];
  cards: MapCard[];
  arrows: MapArrow[];
}

/** A map with its board as the viewer sees it. */
export interface RelationshipMapDetail extends RelationshipMap, Board {}

/** The fields of the create and settings forms. */
export interface MapFormValues {
  name: string;
  description: string;
  visibility: DocumentVisibility;
  selectiveUserIds: string[];
  /** Chosen when the map is created only (spec 38 Decision 1). */
  kind?: MapKind;
  /** In the settings of an existing map only (spec 42 Decision 1). */
  playersCanEdit?: boolean;
}

/**
 * A Document's live mention map (spec 36) as the viewer sees it: computed from
 * the mentions they see on every load. It has no groups; `canManage` lets its
 * creator and the Master change the depth, move and recolor cards, copy or
 * delete it.
 */
export interface MentionMap extends Board {
  id: string;
  documentId: string;
  /** How many steps past the first level it follows mentions (0 to 3). */
  depth: number;
  createdBy: string;
  updatedAt: string;
  canManage: boolean;
  /** Documents past the 150-card cap, not drawn. */
  documentsLeftOut: number;
}

/** What a mention map at a depth would hold for the viewer (Decision 11). */
export interface MentionMapPreview {
  /** The other Documents, the center left out. */
  documents: number;
  relations: number;
  documentsLeftOut: number;
}
