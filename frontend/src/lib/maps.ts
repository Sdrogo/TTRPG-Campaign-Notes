import type { Document, DocumentVisibility } from '../types/document';
import type { RawImage, StoredImage } from '../types/image';
import type {
  ArrowDirection,
  ArrowEnd,
  Board,
  CardSize,
  MapArrow,
  MapCard,
  MapColor,
  MapDocument,
  MapGroup,
  MapFormValues,
  MapKind,
  MentionMap,
  MentionMapPreview,
  RelationshipMap,
  RelationshipMapDetail,
} from '../types/map';
import { leadImage, toStoredImage } from './images';

// --- The wire shape ---------------------------------------------------------

export interface RawMap {
  id: string;
  room_id: string;
  name: string;
  description: string;
  kind: MapKind;
  plane_width: number | null;
  plane_height: number | null;
  visibility: DocumentVisibility;
  selective_user_ids: string[] | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  document_count: number;
  players_can_edit: boolean;
  revision: number;
  can_edit: boolean;
  can_manage: boolean;
}

export interface RawMapGroup {
  id: string;
  title: string | null;
  color: MapColor;
  struck: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RawMapCard {
  id: string;
  document_id: string | null;
  text: string | null;
  group_id: string | null;
  caption: string | null;
  image_id: string | null;
  size: CardSize;
  master_only: boolean;
  color: MapColor;
  struck: boolean;
  x: number;
  y: number;
  document: {
    id: string;
    name: string;
    subtitle: string | null;
    image: RawImage | null;
    tag_ids: string[];
  } | null;
}

interface RawArrowEnd {
  card_id: string | null;
  group_id: string | null;
}

export interface RawMapArrow {
  id: string;
  from_end: RawArrowEnd;
  to_end: RawArrowEnd;
  direction: ArrowDirection;
  label: string | null;
  reverse_label: string | null;
  label_position: number | null;
  reverse_label_position: number | null;
  label_offset: number | null;
  reverse_label_offset: number | null;
  color: MapColor;
  master_only: boolean;
}

export interface RawMapDetail extends RawMap {
  groups: RawMapGroup[];
  cards: RawMapCard[];
  arrows: RawMapArrow[];
}

export function toMap(raw: RawMap): RelationshipMap {
  return {
    id: raw.id,
    roomId: raw.room_id,
    name: raw.name,
    description: raw.description,
    kind: raw.kind,
    planeWidth: raw.plane_width,
    planeHeight: raw.plane_height,
    visibility: raw.visibility,
    selectiveUserIds: raw.selective_user_ids,
    createdBy: raw.created_by,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    documentCount: raw.document_count,
    playersCanEdit: raw.players_can_edit,
    revision: raw.revision,
    canEdit: raw.can_edit,
    canManage: raw.can_manage,
  };
}

function toEnd(raw: RawArrowEnd): ArrowEnd {
  return { cardId: raw.card_id, groupId: raw.group_id };
}

function toCard(card: RawMapCard): MapCard {
  return {
    id: card.id,
    documentId: card.document_id,
    text: card.text,
    groupId: card.group_id,
    caption: card.caption,
    imageId: card.image_id,
    size: card.size,
    masterOnly: card.master_only,
    color: card.color,
    struck: card.struck,
    x: card.x,
    y: card.y,
    document: card.document && {
      id: card.document.id,
      name: card.document.name,
      subtitle: card.document.subtitle,
      image: card.document.image && toStoredImage(card.document.image),
      tagIds: card.document.tag_ids,
    },
  };
}

function toArrow(arrow: RawMapArrow): MapArrow {
  return {
    id: arrow.id,
    from: toEnd(arrow.from_end),
    to: toEnd(arrow.to_end),
    direction: arrow.direction,
    label: arrow.label,
    reverseLabel: arrow.reverse_label,
    labelPosition: arrow.label_position,
    reverseLabelPosition: arrow.reverse_label_position,
    labelOffset: arrow.label_offset,
    reverseLabelOffset: arrow.reverse_label_offset,
    color: arrow.color,
    masterOnly: arrow.master_only,
  };
}

export function toMapDetail(raw: RawMapDetail): RelationshipMapDetail {
  return {
    ...toMap(raw),
    groups: raw.groups.map((group) => ({ ...group })),
    cards: raw.cards.map(toCard),
    arrows: raw.arrows.map(toArrow),
  };
}

export interface RawMentionMap {
  id: string;
  document_id: string;
  depth: number;
  created_by: string;
  updated_at: string;
  can_manage: boolean;
  cards: RawMapCard[];
  arrows: RawMapArrow[];
  documents_left_out: number;
}

export interface RawMentionMapPreview {
  documents: number;
  relations: number;
  documents_left_out: number;
}

/** A Document's mention map (spec 36) from the wire shape. */
export function toMentionMap(raw: RawMentionMap): MentionMap {
  return {
    id: raw.id,
    documentId: raw.document_id,
    depth: raw.depth,
    createdBy: raw.created_by,
    updatedAt: raw.updated_at,
    canManage: raw.can_manage,
    groups: [],
    cards: raw.cards.map(toCard),
    arrows: raw.arrows.map(toArrow),
    documentsLeftOut: raw.documents_left_out,
  };
}

/** What a mention map at a depth would hold (spec 36 Decision 11). */
export function toMentionMapPreview(raw: RawMentionMapPreview): MentionMapPreview {
  return {
    documents: raw.documents,
    relations: raw.relations,
    documentsLeftOut: raw.documents_left_out,
  };
}

/** For a board drawn read-only, which never changes (the mention map panel). */
export function ignoreBoardChange(): void {}

/**
 * The cards of a mention map someone moved or recolored since `saved`, as
 * `PUT .../mention-map/cards` takes them (spec 36 Decision 9): the others keep
 * their place.
 */
export function changedMentionCards(saved: Board, board: Board) {
  const before = new Map(saved.cards.map((card) => [card.id, card]));
  return board.cards
    .filter((card) => {
      const old = before.get(card.id);
      return !old || old.x !== card.x || old.y !== card.y || old.color !== card.color;
    })
    .map((card) => ({ document_id: card.documentId!, x: card.x, y: card.y, color: card.color }));
}

function toEndBody(end: ArrowEnd): RawArrowEnd {
  return { card_id: end.cardId, group_id: end.groupId };
}

/**
 * The board as the API takes it, item by item: the whole board for
 * `PUT .../board` with the map revision it started from (spec 42 Decision 7),
 * or only the changed items for `PATCH .../board` (spec 43, `toChangesBody`).
 */
export function toBoardBody(board: Board, baseRevision?: number) {
  return {
    ...(baseRevision !== undefined && { base_revision: baseRevision }),
    groups: board.groups.map((group) => ({ ...group })),
    cards: board.cards.map((card) => ({
      id: card.id,
      document_id: card.documentId,
      text: card.text,
      group_id: card.groupId,
      caption: card.caption,
      image_id: card.imageId,
      size: card.size,
      master_only: card.masterOnly,
      color: card.color,
      struck: card.struck,
      x: card.x,
      y: card.y,
    })),
    arrows: board.arrows.map((arrow) => ({
      id: arrow.id,
      from_end: toEndBody(arrow.from),
      to_end: toEndBody(arrow.to),
      direction: arrow.direction,
      label: arrow.label,
      reverse_label: arrow.direction === 'both' ? arrow.reverseLabel : null,
      label_position: arrow.label ? arrow.labelPosition : null,
      reverse_label_position:
        arrow.direction === 'both' && arrow.reverseLabel ? arrow.reverseLabelPosition : null,
      label_offset: arrow.label ? arrow.labelOffset : null,
      reverse_label_offset:
        arrow.direction === 'both' && arrow.reverseLabel ? arrow.reverseLabelOffset : null,
      color: arrow.color,
      master_only: arrow.masterOnly,
    })),
  };
}

/**
 * A map's create or settings form, as the API takes it; `kind` only when the
 * form chose one, on create (spec 38 Decision 1).
 */
export function toMapBody(values: MapFormValues) {
  return {
    name: values.name,
    description: values.description,
    visibility: values.visibility,
    selective_user_ids: values.visibility === 'selective' ? values.selectiveUserIds : [],
    ...(values.kind && { kind: values.kind }),
    ...(values.playersCanEdit !== undefined && { players_can_edit: values.playersCanEdit }),
  };
}

// --- Looks ------------------------------------------------------------------

/** The theme colors, in the order the pickers offer them. */
export const MAP_COLORS: MapColor[] = [
  'default',
  'red',
  'green',
  'purple',
  'blue',
  'gold',
  'orange',
  'midnight',
  'silver',
  'champagne',
  'rose',
  'pink',
  'cobalt',
  'violet',
  'emerald',
  'brown',
  'lime',
];

/** How many colors the picker shows before "more colors" (one row). */
export const MAP_COLORS_VISIBLE = 6;

const COLOR_VALUES: Record<MapColor, string> = {
  default: 'var(--text-primary)',
  red: 'var(--accent-strong)',
  green: 'var(--mantine-color-green-5)',
  purple: 'var(--mantine-color-grape-5)',
  blue: 'var(--mantine-color-blue-5)',
  gold: 'var(--mantine-color-yellow-5)',
  orange: '#FF9500',
  midnight: '#4251B0',
  silver: '#B5B5AC',
  champagne: '#C1A470',
  rose: '#EE86A7',
  pink: '#E85298',
  cobalt: '#0079C2',
  violet: '#8F76D6',
  emerald: '#00AC9B',
  brown: '#9C5E31',
  lime: '#9ACD32',
};

/** The CSS color a map color stands for, from the theme. */
export function colorValue(color: MapColor): string {
  return COLOR_VALUES[color];
}

/** A card's width on the board; its height follows its content. */
export const CARD_WIDTH = 160;
/** How much room a card takes when its size isn't known yet. */
export const DEFAULT_CARD_SIZE = { width: CARD_WIDTH, height: 90 };
/** The space between a group's frame and the cards it was made around. */
export const GROUP_PADDING = 24;
/** The smallest frame a group can be resized to; the backend's floor too. */
export const MIN_GROUP_SIZE = 40;
/** Room above the cards for a group's title. */
const GROUP_TITLE_SPACE = 32;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

// --- Editing a board --------------------------------------------------------

/** A new id for something added on the board; the backend takes the client's. */
export function newId(): string {
  return crypto.randomUUID();
}

/** The node id of an arrow end: the card's or the group's id. */
export function endId(end: ArrowEnd): string {
  return (end.cardId ?? end.groupId)!;
}

/** Where a card sits on the board, adding its group's corner when it is in one. */
export function absolutePosition(board: Board, card: MapCard): Point {
  const group = card.groupId ? board.groups.find((g) => g.id === card.groupId) : undefined;
  return group ? { x: card.x + group.x, y: card.y + group.y } : { x: card.x, y: card.y };
}

/**
 * Puts Documents on the board around `center`, in rows of four, so that a
 * picker's selection lands where the editor is looking.
 */
export function addDocumentCards(board: Board, documents: MapDocument[], center: Point): Board {
  const columns = Math.min(4, documents.length);
  const cards = documents.map((document, index) => ({
    id: newId(),
    documentId: document.id,
    text: null,
    groupId: null,
    caption: null,
    imageId: null,
    size: 'normal' as const,
    masterOnly: false,
    color: 'default' as const,
    struck: false,
    x: center.x + ((index % columns) - columns / 2) * (CARD_WIDTH + 24),
    y: center.y + Math.floor(index / columns) * 140,
    document,
  }));
  return { ...board, cards: [...board.cards, ...cards] };
}

export interface TextCardValues {
  text: string;
  size: CardSize;
  color: MapColor;
  struck: boolean;
  masterOnly: boolean;
}

/** Adds a text card at `center`; returns the board and the new card's id. */
export function addTextCard(board: Board, values: TextCardValues, center: Point): [Board, string] {
  const card: MapCard = {
    id: newId(),
    documentId: null,
    groupId: null,
    caption: null,
    imageId: null,
    ...values,
    x: center.x - CARD_WIDTH / 2,
    y: center.y,
    document: null,
  };
  return [{ ...board, cards: [...board.cards, card] }, card.id];
}

/** Changes one card. */
export function updateCard(board: Board, cardId: string, patch: Partial<MapCard>): Board {
  return {
    ...board,
    cards: board.cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card)),
  };
}

function touches(arrow: MapArrow, ids: Set<string>): boolean {
  return ids.has(endId(arrow.from)) || ids.has(endId(arrow.to));
}

/** Takes cards off the board, with every arrow touching them. */
export function removeCards(board: Board, cardIds: string[]): Board {
  const ids = new Set(cardIds);
  return {
    ...board,
    cards: board.cards.filter((card) => !ids.has(card.id)),
    arrows: board.arrows.filter((arrow) => !touches(arrow, ids)),
  };
}

/**
 * Removes a group: its cards stay where they are, outside any group, and the
 * arrows pointing at the group go with it.
 */
export function removeGroup(board: Board, groupId: string): Board {
  const ids = new Set([groupId]);
  return {
    groups: board.groups.filter((group) => group.id !== groupId),
    cards: board.cards.map((card) =>
      card.groupId === groupId ? { ...card, ...absolutePosition(board, card), groupId: null } : card,
    ),
    arrows: board.arrows.filter((arrow) => !touches(arrow, ids)),
  };
}

/** Changes one group (its title, look or frame). */
export function updateGroup(board: Board, groupId: string, patch: Partial<MapGroup>): Board {
  return {
    ...board,
    groups: board.groups.map((group) => (group.id === groupId ? { ...group, ...patch } : group)),
  };
}

/**
 * Frames these cards in a new group, with room for a title above them; cards
 * already in another group leave it. Returns the board unchanged, and no id,
 * when none of the ids is a card.
 */
export function groupCards(
  board: Board,
  cardIds: string[],
  sizes: Record<string, Size | undefined>,
): [Board, string | null] {
  const chosen = board.cards.filter((card) => cardIds.includes(card.id));
  if (chosen.length === 0) return [board, null];
  const boxes = chosen.map((card) => {
    const { x, y } = absolutePosition(board, card);
    const { width, height } = sizes[card.id] ?? DEFAULT_CARD_SIZE;
    return { x, y, right: x + width, bottom: y + height };
  });
  const left = Math.min(...boxes.map((box) => box.x)) - GROUP_PADDING;
  const top = Math.min(...boxes.map((box) => box.y)) - GROUP_PADDING - GROUP_TITLE_SPACE;
  const right = Math.max(...boxes.map((box) => box.right)) + GROUP_PADDING;
  const bottom = Math.max(...boxes.map((box) => box.bottom)) + GROUP_PADDING;
  const group: MapGroup = {
    id: newId(),
    title: null,
    color: 'default',
    struck: false,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
  const ids = new Set(cardIds);
  return [
    {
      ...board,
      groups: [...board.groups, group],
      cards: board.cards.map((card) => {
        if (!ids.has(card.id)) return card;
        const { x, y } = absolutePosition(board, card);
        return { ...card, groupId: group.id, x: x - left, y: y - top };
      }),
    },
    group.id,
  ];
}

function inside(point: Point, group: MapGroup): boolean {
  return (
    point.x >= group.x &&
    point.x <= group.x + group.width &&
    point.y >= group.y &&
    point.y <= group.y + group.height
  );
}

/**
 * A card dropped at `position` (its top left corner on the board): it joins
 * the group its center lands in, or leaves its group when dropped outside it.
 */
export function dropCard(board: Board, cardId: string, position: Point, size: Size): Board {
  const center = {
    x: position.x + size.width / 2,
    y: position.y + size.height / 2,
  };
  const group = board.groups.find((candidate) => inside(center, candidate));
  return updateCard(
    board,
    cardId,
    group
      ? { groupId: group.id, x: position.x - group.x, y: position.y - group.y }
      : { groupId: null, x: position.x, y: position.y },
  );
}

/** Adds an arrow between two ends, one way and unlabelled; returns its id. */
export function addArrow(board: Board, from: ArrowEnd, to: ArrowEnd): [Board, string] {
  const arrow: MapArrow = {
    id: newId(),
    from,
    to,
    direction: 'forward',
    label: null,
    reverseLabel: null,
    labelPosition: null,
    reverseLabelPosition: null,
    labelOffset: null,
    reverseLabelOffset: null,
    color: 'default',
    masterOnly: false,
  };
  return [{ ...board, arrows: [...board.arrows, arrow] }, arrow.id];
}

/** Changes one arrow. */
export function updateArrow(board: Board, arrowId: string, patch: Partial<MapArrow>): Board {
  return {
    ...board,
    arrows: board.arrows.map((arrow) => (arrow.id === arrowId ? { ...arrow, ...patch } : arrow)),
  };
}

/** Takes an arrow off the board. */
export function removeArrow(board: Board, arrowId: string): Board {
  return {
    ...board,
    arrows: board.arrows.filter((arrow) => arrow.id !== arrowId),
  };
}

/** The arrow end a board node stands for: a card or a group. */
export function endOf(board: Board, nodeId: string): ArrowEnd {
  return board.groups.some((group) => group.id === nodeId)
    ? { cardId: null, groupId: nodeId }
    : { cardId: nodeId, groupId: null };
}

// --- Drawing arrows ---------------------------------------------------------

export interface Rect extends Point, Size {}

/** Where the line from a box's center toward `toward` leaves the box. */
function boxExit(box: Rect, toward: Point): Point {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(
    dx === 0 ? Infinity : box.width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : box.height / 2 / Math.abs(dy),
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/**
 * An arrow's two ends: the points where the line between the two boxes'
 * centers leaves each box, so the arrow heads touch the cards' edges
 * whatever side they face.
 */
export function arrowEnds(source: Rect, target: Rect): { from: Point; to: Point } {
  const sourceCenter = {
    x: source.x + source.width / 2,
    y: source.y + source.height / 2,
  };
  const targetCenter = {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  };
  return {
    from: boxExit(source, targetCenter),
    to: boxExit(target, sourceCenter),
  };
}

/** Pixels between two parallel lines drawn side by side. */
export const PARALLEL_GAP = 7;

/**
 * How far to the side of the straight line between two ends an arrow is
 * drawn. Plain lines (direction `none`) joining the same two ends sit side
 * by side, in the order they were added, centered on the straight line, so a
 * metro-style map can show several relations between two cards. Other arrows
 * (and a lone line) are not shifted. The sign is relative to the arrow's
 * own direction, so a line drawn the other way round still lands on its own
 * lane of the same bundle.
 */
export function parallelShift(arrows: MapArrow[], arrow: MapArrow): number {
  if (arrow.direction !== 'none') return 0;
  const a = endId(arrow.from);
  const b = endId(arrow.to);
  const bundle = arrows.filter((other) => {
    if (other.direction !== 'none') return false;
    const x = endId(other.from);
    const y = endId(other.to);
    return (x === a && y === b) || (x === b && y === a);
  });
  if (bundle.length < 2) return 0;
  const lane = bundle.findIndex((other) => other.id === arrow.id);
  return (lane - (bundle.length - 1) / 2) * PARALLEL_GAP * (a < b ? 1 : -1);
}

/** `from` and `to` both moved `shift` pixels to the side of the line between them. */
export function shiftParallel(from: Point, to: Point, shift: number): { from: Point; to: Point } {
  if (shift === 0) return { from, to };
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const dx = (-(to.y - from.y) / length) * shift;
  const dy = ((to.x - from.x) / length) * shift;
  return { from: { x: from.x + dx, y: from.y + dy }, to: { x: to.x + dx, y: to.y + dy } };
}

/** The point a fraction `t` of the way from `from` to `to`. */
export function pointAlong(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** Rough size of an arrow label's box, from its text (the xs font, 1px border, 6px padding). */
export function labelSize(text: string): { width: number; height: number } {
  return { width: Math.ceil(text.length * 7) + 14, height: 24 };
}

/** Whether two rectangles come within `gap` pixels of each other (or overlap). */
function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  );
}

/**
 * How far along the line from `from` to `to` the point `p` falls, as a
 * fraction from 0 to 1 (a point past an end counts as that end).
 */
export function projectOnLine(from: Point, to: Point, p: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return 0.5;
  const t = ((p.x - from.x) * dx + (p.y - from.y) * dy) / lengthSquared;
  return Math.min(1, Math.max(0, t));
}

/** The farthest a label may be dragged from its relation, in board pixels (the backend refuses more). */
export const MAX_LABEL_OFFSET = 2000;

/**
 * How far, in the same units as the points, `p` is to the side of the line
 * from `from` to `to`: positive on the right of the way from `from` to `to`
 * (on screen, where y grows downward), negative on the left, 0 on the line;
 * never more than `MAX_LABEL_OFFSET` either way.
 */
export function offsetFromLine(from: Point, to: Point, p: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return 0;
  const offset = ((p.x - from.x) * -dy + (p.y - from.y) * dx) / length;
  return Math.max(-MAX_LABEL_OFFSET, Math.min(MAX_LABEL_OFFSET, offset));
}

/** The point `offset` to the side of the way `t` along the line (see `offsetFromLine`). */
export function pointBeside(from: Point, to: Point, t: number, offset: number): Point {
  const along = pointAlong(from, to, t);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return along;
  return { x: along.x + (-(to.y - from.y) / length) * offset, y: along.y + ((to.x - from.x) / length) * offset };
}

/**
 * Where an arrow's label (its center) goes: the point of the line closest to
 * `preferred` (a fraction of the way from `from` to `to`) where the label's
 * box clears every rectangle in `avoid` (the cards the arrow joins, and the
 * labels already placed), so a card never covers it. When nowhere along the
 * line is clear (a short arrow between cards), the label moves sideways, to
 * the right or the left, the least it takes to clear them, still beside the
 * arrow. The label's center never leaves `within` (the area the two cards
 * span), so it is never thrown past a card to the far side. When even that
 * finds no room, it stays at `preferred`.
 */
export function placeLabel(
  from: Point,
  to: Point,
  preferred: number,
  size: { width: number; height: number },
  avoid: Rect[],
  within: Rect,
): Point {
  const STEPS = 50;
  const GAP = 6;
  const SHIFT_STEP = 8;
  const MAX_SHIFT = 400;
  const clearAt = (at: Point): boolean => {
    if (
      at.x < within.x ||
      at.x > within.x + within.width ||
      at.y < within.y ||
      at.y > within.y + within.height
    ) {
      return false;
    }
    const box = { x: at.x - size.width / 2, y: at.y - size.height / 2, ...size };
    return !avoid.some((rect) => overlaps(box, rect, GAP));
  };
  for (let shift = 0; shift <= MAX_SHIFT; shift += SHIFT_STEP) {
    for (const dx of shift === 0 ? [0] : [shift, -shift]) {
      let best: number | null = null;
      for (let i = 0; i <= STEPS; i += 1) {
        const t = i / STEPS;
        if (best !== null && Math.abs(t - preferred) >= Math.abs(best - preferred)) continue;
        const at = pointAlong(from, to, t);
        if (clearAt({ x: at.x + dx, y: at.y })) best = t;
      }
      if (best !== null) {
        const at = pointAlong(from, to, best);
        return { x: at.x + dx, y: at.y };
      }
    }
  }
  return pointAlong(from, to, preferred);
}

/**
 * The image a card shows from its Document's `images` (favorite first): the
 * one chosen for it, else the favorite. Undefined when there are none.
 */
export function cardImage(images: StoredImage[], imageId: string | null): StoredImage | undefined {
  return images.find((image) => image.id === imageId) ?? leadImage(images);
}

/** What a Document card needs from a Document of the Room's list. */
export function toMapDocument(document: Document): MapDocument {
  return {
    id: document.id,
    name: document.name,
    subtitle: document.subtitle,
    image: leadImage(document.images) ?? null,
    tagIds: document.tagIds,
  };
}
