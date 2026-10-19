import type { RawImage } from '../types/image';
import type {
  Corner,
  GeoArea,
  GeoBoard,
  GeoLink,
  GeoLinkEnd,
  GeoMapDetail,
  GeoPin,
  LabelSide,
} from '../types/geoMap';
import type { ArrowDirection, MapColor, MapDocument } from '../types/map';
import { toStoredImage } from './images';
import { newId, pointAlong, pointBeside, toMap, type Point, type RawMap } from './maps';

// --- Limits (the backend's, spec 38) ----------------------------------------

/** The most corners an area takes. */
export const MAX_AREA_POINTS = 60;
/** The longest name a plain area or pin takes. */
export const MAX_PLACE_NAME_LENGTH = 80;
/** The longest note a plain area or pin takes. */
export const MAX_NOTE_LENGTH = 500;
/** The smallest and largest side of a plane, in map units. */
export const MIN_PLANE_SIZE = 100;
export const MAX_PLANE_SIZE = 20_000;
/** The farthest a link's curve may leave its straight line. */
export const MAX_BEND = 5000;

// --- The wire shape ---------------------------------------------------------

interface RawMapDocument {
  id: string;
  name: string;
  subtitle: string | null;
  image: RawImage | null;
  tag_ids: string[];
}

export interface RawGeoArea {
  id: string;
  document_id: string | null;
  name: string | null;
  subtitle: string | null;
  note: string | null;
  points: Corner[];
  color: MapColor;
  dashed: boolean;
  filled: boolean;
  master_only: boolean;
  document: RawMapDocument | null;
}

export interface RawGeoPin {
  id: string;
  document_id: string | null;
  name: string | null;
  note: string | null;
  x: number;
  y: number;
  label_side: LabelSide;
  color: MapColor;
  master_only: boolean;
  document: RawMapDocument | null;
}

interface RawGeoLinkEnd {
  area_id: string | null;
  pin_id: string | null;
}

export interface RawGeoLink {
  id: string;
  from_end: RawGeoLinkEnd;
  to_end: RawGeoLinkEnd;
  direction: ArrowDirection;
  label: string | null;
  reverse_label: string | null;
  bend: number | null;
  label_position: number | null;
  reverse_label_position: number | null;
  label_offset: number | null;
  reverse_label_offset: number | null;
  color: MapColor;
  master_only: boolean;
}

export interface RawGeoMapDetail extends RawMap {
  background_url: string | null;
  areas: RawGeoArea[];
  pins: RawGeoPin[];
  links: RawGeoLink[];
}

function toDocumentLook(raw: RawMapDocument | null): MapDocument | null {
  return (
    raw && {
      id: raw.id,
      name: raw.name,
      subtitle: raw.subtitle,
      image: raw.image && toStoredImage(raw.image),
      tagIds: raw.tag_ids,
    }
  );
}

function toLinkEnd(raw: RawGeoLinkEnd): GeoLinkEnd {
  return { areaId: raw.area_id, pinId: raw.pin_id };
}

/** A geographic map from `GET .../maps/{id}/geo` (spec 38). */
export function toGeoMapDetail(raw: RawGeoMapDetail): GeoMapDetail {
  return {
    ...toMap(raw),
    planeWidth: raw.plane_width!,
    planeHeight: raw.plane_height!,
    backgroundUrl: raw.background_url,
    areas: raw.areas.map((area) => ({
      id: area.id,
      documentId: area.document_id,
      name: area.name,
      subtitle: area.subtitle,
      note: area.note,
      points: area.points.map(([x, y]): Corner => [x, y]),
      color: area.color,
      dashed: area.dashed,
      filled: area.filled,
      masterOnly: area.master_only,
      document: toDocumentLook(area.document),
    })),
    pins: raw.pins.map((pin) => ({
      id: pin.id,
      documentId: pin.document_id,
      name: pin.name,
      note: pin.note,
      x: pin.x,
      y: pin.y,
      labelSide: pin.label_side,
      color: pin.color,
      masterOnly: pin.master_only,
      document: toDocumentLook(pin.document),
    })),
    links: raw.links.map((link) => ({
      id: link.id,
      from: toLinkEnd(link.from_end),
      to: toLinkEnd(link.to_end),
      direction: link.direction,
      label: link.label,
      reverseLabel: link.reverse_label,
      bend: link.bend,
      labelPosition: link.label_position,
      reverseLabelPosition: link.reverse_label_position,
      labelOffset: link.label_offset,
      reverseLabelOffset: link.reverse_label_offset,
      color: link.color,
      masterOnly: link.master_only,
    })),
  };
}

function toLinkEndBody(end: GeoLinkEnd): RawGeoLinkEnd {
  return { area_id: end.areaId, pin_id: end.pinId };
}

/**
 * The map as `PUT .../geo` takes it: everything the editor sees. A
 * Document's area or pin sends no texts of its own (they follow the
 * Document); a two-way link's reverse label only on a two-way link.
 */
export function toGeoBody(board: GeoBoard) {
  return {
    areas: board.areas.map((area) => ({
      id: area.id,
      document_id: area.documentId,
      name: area.documentId ? null : area.name,
      subtitle: area.documentId ? null : area.subtitle,
      note: area.documentId ? null : area.note,
      points: area.points,
      color: area.color,
      dashed: area.dashed,
      filled: area.filled,
      master_only: area.documentId ? false : area.masterOnly,
    })),
    pins: board.pins.map((pin) => ({
      id: pin.id,
      document_id: pin.documentId,
      name: pin.documentId ? null : pin.name,
      note: pin.documentId ? null : pin.note,
      x: pin.x,
      y: pin.y,
      label_side: pin.labelSide,
      color: pin.color,
      master_only: pin.documentId ? false : pin.masterOnly,
    })),
    links: board.links.map((link) => ({
      id: link.id,
      from_end: toLinkEndBody(link.from),
      to_end: toLinkEndBody(link.to),
      direction: link.direction,
      label: link.label,
      reverse_label: link.direction === 'both' ? link.reverseLabel : null,
      bend: link.bend,
      label_position: link.labelPosition,
      reverse_label_position: link.direction === 'both' ? link.reverseLabelPosition : null,
      label_offset: link.labelOffset,
      reverse_label_offset: link.direction === 'both' ? link.reverseLabelOffset : null,
      color: link.color,
      master_only: link.masterOnly,
    })),
  };
}

// --- Reading a map ----------------------------------------------------------

/** What a click picked on the map: an area or a pin. */
export type GeoItemRef = { kind: 'area' | 'pin'; id: string };

/** An area's or pin's name: its Document's, or its own on a plain one. */
export function placeName(item: GeoArea | GeoPin): string {
  return item.document?.name ?? item.name ?? '';
}

/** An area's subtitle: its Document's, or its own on a plain one. */
export function placeSubtitle(area: GeoArea): string | null {
  return area.document ? area.document.subtitle : area.subtitle;
}

/** The Documents placed on the map, each at most once (Decision 4). */
export function placedDocumentIds(board: GeoBoard): Set<string> {
  return new Set(
    [...board.areas, ...board.pins].flatMap((item) => (item.documentId ? [item.documentId] : [])),
  );
}

/** The area or pin a reference names, if it is still on the map. */
export function findItem(board: GeoBoard, ref: GeoItemRef): GeoArea | GeoPin | undefined {
  return ref.kind === 'area'
    ? board.areas.find((area) => area.id === ref.id)
    : board.pins.find((pin) => pin.id === ref.id);
}

/** A link end as a reference to its area or pin. */
export function endRef(end: GeoLinkEnd): GeoItemRef {
  return end.areaId ? { kind: 'area', id: end.areaId } : { kind: 'pin', id: end.pinId! };
}

/**
 * Whether the Tag filter (Decision 8) dims an item: a filter is on and the
 * item has no Document carrying the Tag.
 */
export function isDimmed(item: GeoArea | GeoPin, tagId: string | null): boolean {
  return tagId !== null && !item.document?.tagIds.includes(tagId);
}

// --- Geometry ---------------------------------------------------------------

/** The surface of the shape through `points` (shoelace formula); 0 for a line. */
export function polygonSurface(points: Corner[]): number {
  let total = 0;
  points.forEach(([x1, y1], index) => {
    const [x2, y2] = points[(index + 1) % points.length];
    total += x1 * y2 - x2 * y1;
  });
  return Math.abs(total) / 2;
}

/**
 * Where an area's name goes and its links meet: the shape's centroid, or the
 * average of its corners when it has no surface.
 */
export function areaCenter(points: Corner[]): Point {
  let signed = 0;
  let cx = 0;
  let cy = 0;
  points.forEach(([x1, y1], index) => {
    const [x2, y2] = points[(index + 1) % points.length];
    const cross = x1 * y2 - x2 * y1;
    signed += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  });
  if (signed === 0) {
    return {
      x: points.reduce((sum, [x]) => sum + x, 0) / points.length,
      y: points.reduce((sum, [, y]) => sum + y, 0) / points.length,
    };
  }
  return { x: cx / (3 * signed), y: cy / (3 * signed) };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Whether `point` is inside the shape through `points` (even-odd rule). */
export function insideShape(point: Point, points: Corner[]): boolean {
  let inside = false;
  points.forEach(([x1, y1], index) => {
    const [x2, y2] = points[(index + 1) % points.length];
    if (y1 > point.y !== y2 > point.y && point.x < ((x2 - x1) * (point.y - y1)) / (y2 - y1) + x1) {
      inside = !inside;
    }
  });
  return inside;
}

/** A label's box, in plane units: its top left corner and its size. */
export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How wide a line of text is, roughly: its fonts average this share of the font size per character. */
export function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.58;
}

function overlap(a: LabelBox, b: LabelBox): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/** An area's name block to place: its corners, and its size around the point it is placed at. */
export interface AreaLabel {
  id: string;
  points: Corner[];
  width: number;
  /** From the placed point up to the block's top, and down to its bottom. */
  above: number;
  below: number;
}

/** How many steps across an area's bounds (and a name's size around them) the label search tries, each way. */
const LABEL_GRID = 14;
/** How much worse covering another label is than sticking out of the area, per unit of surface. */
const COVER_WEIGHT = 10;

/**
 * Where each area's name goes (spec 38b): its centroid when the name fits
 * there inside the area without covering any of `obstacles` (the pins and
 * their names, the links' labels), else the point of a grid over the area,
 * and a name's size around it, that covers the least of them and of the
 * names placed before it, inside the area (and out of the others) and near
 * its centroid when it can: a name too big for a crowded area goes beside it
 * rather than over a pin.
 */
export function placeAreaLabels(labels: AreaLabel[], obstacles: LabelBox[]): Map<string, Point> {
  const placed = new Map<string, Point>();
  const taken = [...obstacles];
  for (const label of labels) {
    const center = areaCenter(label.points);
    const xs = label.points.map(([x]) => x);
    const ys = label.points.map(([, y]) => y);
    const [left, top] = [Math.min(...xs) - label.width / 2, Math.min(...ys) - label.above - label.below];
    const [width, height] = [Math.max(...xs) + label.width / 2 - left, Math.max(...ys) + label.above + label.below - top];
    const reach = Math.hypot(width, height);
    const surface = label.width * (label.above + label.below);
    const boxAt = (at: Point): LabelBox => ({
      x: at.x - label.width / 2,
      y: at.y - label.above,
      width: label.width,
      height: label.above + label.below,
    });
    const score = (at: Point) => {
      const box = boxAt(at);
      const covered = taken.reduce((sum, other) => sum + overlap(box, other), 0);
      const corners: Point[] = [
        at,
        { x: box.x, y: box.y },
        { x: box.x + box.width, y: box.y },
        { x: box.x, y: box.y + box.height },
        { x: box.x + box.width, y: box.y + box.height },
      ];
      const outside = corners.filter((corner) => !insideShape(corner, label.points)).length;
      const far = Math.hypot(at.x - center.x, at.y - center.y) / reach;
      // A name sitting in another area reads as that area's.
      const elsewhere = labels.some((other) => other !== label && insideShape(at, other.points)) ? surface : 0;
      return covered * COVER_WEIGHT + (outside / corners.length) * surface + elsewhere + far * surface;
    };
    let best = center;
    let bestScore = score(center);
    for (let i = 0; i <= LABEL_GRID; i++) {
      for (let j = 0; j <= LABEL_GRID; j++) {
        const candidate = { x: left + (width * i) / LABEL_GRID, y: top + (height * j) / LABEL_GRID };
        const candidateScore = score(candidate);
        if (candidateScore < bestScore) {
          best = candidate;
          bestScore = candidateScore;
        }
      }
    }
    placed.set(label.id, best);
    taken.push(boxAt(best));
  }
  return placed;
}

/** A point kept inside the plane. */
export function clampToPlane(point: Point, width: number, height: number): Point {
  return { x: clamp(point.x, 0, width), y: clamp(point.y, 0, height) };
}

/** The corners moved by `dx`, `dy`, as far as the plane lets every one of them go. */
export function moveCorners(points: Corner[], dx: number, dy: number, width: number, height: number): Corner[] {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const sx = clamp(dx, -Math.min(...xs), width - Math.max(...xs));
  const sy = clamp(dy, -Math.min(...ys), height - Math.max(...ys));
  return points.map(([x, y]) => [x + sx, y + sy]);
}

/** The corners with one moved to `to` (kept inside the plane). */
export function moveCorner(points: Corner[], index: number, to: Point, width: number, height: number): Corner[] {
  const at = clampToPlane(to, width, height);
  return points.map((corner, i) => (i === index ? [at.x, at.y] : corner));
}

/** The corners with a new one after `index`, at the middle of that side; unchanged at the cap. */
export function insertCorner(points: Corner[], index: number): Corner[] {
  if (points.length >= MAX_AREA_POINTS) return points;
  const [x1, y1] = points[index];
  const [x2, y2] = points[(index + 1) % points.length];
  return [...points.slice(0, index + 1), [(x1 + x2) / 2, (y1 + y2) / 2], ...points.slice(index + 1)];
}

/** The corners without one; unchanged when the shape would drop under 3 corners. */
export function removeCorner(points: Corner[], index: number): Corner[] {
  return points.length <= 3 ? points : points.filter((_, i) => i !== index);
}

/** Where a link end sits: the pin, or the area's center. Undefined once it is gone. */
export function endPoint(board: GeoBoard, end: GeoLinkEnd): Point | undefined {
  if (end.pinId) {
    const pin = board.pins.find((candidate) => candidate.id === end.pinId);
    return pin && { x: pin.x, y: pin.y };
  }
  const area = board.areas.find((candidate) => candidate.id === end.areaId);
  return area && areaCenter(area.points);
}

/** How much a link with no bend of its own curves, as a share of its length. */
export const DEFAULT_BEND_RATIO = 0.12;
/** How far apart links sharing both ends (and no bend of their own) curve. */
export const PARALLEL_BEND = 40;

function sameEnds(a: GeoLink, b: GeoLink): boolean {
  const key = (end: GeoLinkEnd) => end.areaId ?? end.pinId;
  return (
    (key(a.from) === key(b.from) && key(a.to) === key(b.to)) ||
    (key(a.from) === key(b.to) && key(a.to) === key(b.from))
  );
}

/**
 * How far a link's middle leaves its straight line (see `offsetFromLine`):
 * its own bend, else a gentle default curve, spread apart for links sharing
 * both ends so none hides another (Decision 5).
 */
export function linkBend(links: GeoLink[], link: GeoLink, length: number): number {
  if (link.bend !== null) return link.bend;
  const siblings = links.filter((other) => other.bend === null && sameEnds(other, link));
  return length * DEFAULT_BEND_RATIO + siblings.indexOf(link) * PARALLEL_BEND;
}

/** A link's curve: a quadratic one whose middle is `bend` off the straight line. */
export interface Curve {
  from: Point;
  control: Point;
  to: Point;
}

/** The curve from `from` to `to` whose middle sits `bend` to the side of the line. */
export function linkCurve(from: Point, to: Point, bend: number): Curve {
  // A quadratic curve's middle is halfway between the line's and the control point.
  return { from, control: pointBeside(from, to, 0.5, bend * 2), to };
}

/** The point a fraction `t` along the curve. */
export function pointOnCurve(curve: Curve, t: number): Point {
  const a = pointAlong(curve.from, curve.control, t);
  const b = pointAlong(curve.control, curve.to, t);
  return pointAlong(a, b, t);
}

/** The SVG path of a curve. */
export function curvePath(curve: Curve): string {
  const { from, control, to } = curve;
  return `M ${from.x},${from.y} Q ${control.x},${control.y} ${to.x},${to.y}`;
}

/**
 * The bend that puts a curve's middle at `p`, dragged by its handle: how far
 * `p` is to the side of the straight line, rounded and within the limit.
 */
export function bendThrough(from: Point, to: Point, p: Point): number {
  // `offsetFromLine`, without the labels' smaller limit.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return 0;
  const offset = ((p.x - from.x) * -dy + (p.y - from.y) * dx) / length;
  return clamp(Math.round(offset), -MAX_BEND, MAX_BEND);
}

/**
 * The three corners of an arrowhead of `size` whose tip is at `tip`, pointing
 * away from `from`, as an SVG `points` list.
 */
export function arrowHead(from: Point, tip: Point, size: number): string {
  const length = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const ux = (tip.x - from.x) / length;
  const uy = (tip.y - from.y) / length;
  const base = { x: tip.x - ux * size, y: tip.y - uy * size };
  const half = size / 2;
  return [
    `${tip.x},${tip.y}`,
    `${base.x - uy * half},${base.y + ux * half}`,
    `${base.x + uy * half},${base.y - ux * half}`,
  ].join(' ');
}

/** The point `distance` back from `tip` toward `from`, where an arrow stops short of a pin. */
export function stopShort(from: Point, tip: Point, distance: number): Point {
  const length = Math.hypot(tip.x - from.x, tip.y - from.y);
  if (length <= distance) return tip;
  return { x: tip.x - ((tip.x - from.x) / length) * distance, y: tip.y - ((tip.y - from.y) / length) * distance };
}

/**
 * Where the segment from `inside` (an area's center) toward `outside` first
 * crosses the area's outline: where a link meets the area. `inside` itself
 * when the segment never leaves the shape.
 */
export function outlineExit(points: Corner[], inside: Point, outside: Point): Point {
  const dx = outside.x - inside.x;
  const dy = outside.y - inside.y;
  let best: number | null = null;
  points.forEach(([ax, ay], index) => {
    const [bx, by] = points[(index + 1) % points.length];
    const ex = bx - ax;
    const ey = by - ay;
    const denominator = dx * ey - dy * ex;
    if (denominator === 0) return;
    // How far along the segment (t) and along the side (u) the two lines cross.
    const t = ((ax - inside.x) * ey - (ay - inside.y) * ex) / denominator;
    const u = ((ax - inside.x) * dy - (ay - inside.y) * dx) / denominator;
    if (t > 0 && t <= 1 && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
  });
  return best === null ? inside : pointAlong(inside, outside, best);
}

/**
 * How a link is drawn: `from` and `to` are its ends' points (a pin, an
 * area's center), the curve between them bent by `linkBend`; `curve` is the
 * part of it shown, from an area's outline and stopping `pinGap` short of a
 * pin. Undefined when an end is not on the map.
 */
export function linkGeometry(
  board: GeoBoard,
  link: GeoLink,
  pinGap: number,
): { from: Point; to: Point; curve: Curve } | undefined {
  const from = endPoint(board, link.from);
  const to = endPoint(board, link.to);
  if (!from || !to) return undefined;
  const curve = linkCurve(from, to, linkBend(board.links, link, Math.hypot(to.x - from.x, to.y - from.y)));
  const trim = (end: GeoLinkEnd, point: Point) => {
    const area = board.areas.find((candidate) => candidate.id === end.areaId);
    return area ? outlineExit(area.points, point, curve.control) : stopShort(curve.control, point, pinGap);
  };
  return { from, to, curve: { from: trim(link.from, from), control: curve.control, to: trim(link.to, to) } };
}

// --- The view (pan and zoom) ------------------------------------------------

/** How the plane is drawn on screen: shifted by `x`, `y` pixels and scaled by `k`. */
export interface View {
  x: number;
  y: number;
  k: number;
}

/** The closest and farthest a map zooms. */
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 8;

/** The view that shows the whole plane centered in a box of `width` × `height` pixels. */
export function fitView(planeWidth: number, planeHeight: number, width: number, height: number): View {
  const k = clamp(Math.min(width / planeWidth, height / planeHeight) * 0.95, MIN_ZOOM, MAX_ZOOM);
  return { x: (width - planeWidth * k) / 2, y: (height - planeHeight * k) / 2, k };
}

/** The view zoomed by `factor` around the screen point `at`, which stays put. */
export function zoomAt(view: View, factor: number, at: Point): View {
  const k = clamp(view.k * factor, MIN_ZOOM, MAX_ZOOM);
  const ratio = k / view.k;
  return { x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio, k };
}

/** The plane point under a screen point (relative to the board's corner). */
export function toPlane(view: View, at: Point): Point {
  return { x: (at.x - view.x) / view.k, y: (at.y - view.y) / view.k };
}

// --- Editing a map ----------------------------------------------------------

/** A new plain area through `points`, waiting for its name. */
export function newArea(points: Corner[]): GeoArea {
  return {
    id: newId(),
    documentId: null,
    name: null,
    subtitle: null,
    note: null,
    points,
    color: 'default',
    dashed: false,
    filled: true,
    masterOnly: false,
    document: null,
  };
}

/** A new plain pin at a point, waiting for its name. */
export function newPin(at: Point): GeoPin {
  return {
    id: newId(),
    documentId: null,
    name: null,
    note: null,
    x: Math.round(at.x),
    y: Math.round(at.y),
    labelSide: 'right',
    color: 'default',
    masterOnly: false,
    document: null,
  };
}

function toEnd(ref: GeoItemRef): GeoLinkEnd {
  return ref.kind === 'area' ? { areaId: ref.id, pinId: null } : { areaId: null, pinId: ref.id };
}

/** The map with a one-way link from one item to another, and the link's id. */
export function addLink(board: GeoBoard, from: GeoItemRef, to: GeoItemRef): [GeoBoard, string] {
  const link: GeoLink = {
    id: newId(),
    from: toEnd(from),
    to: toEnd(to),
    direction: 'forward',
    label: null,
    reverseLabel: null,
    bend: null,
    labelPosition: null,
    reverseLabelPosition: null,
    labelOffset: null,
    reverseLabelOffset: null,
    color: 'default',
    masterOnly: false,
  };
  return [{ ...board, links: [...board.links, link] }, link.id];
}

/** The map with an area added, or replaced when its id is already there. */
export function putArea(board: GeoBoard, area: GeoArea): GeoBoard {
  const exists = board.areas.some((candidate) => candidate.id === area.id);
  return {
    ...board,
    areas: exists
      ? board.areas.map((candidate) => (candidate.id === area.id ? area : candidate))
      : [...board.areas, area],
  };
}

/** The map with a pin added, or replaced when its id is already there. */
export function putPin(board: GeoBoard, pin: GeoPin): GeoBoard {
  const exists = board.pins.some((candidate) => candidate.id === pin.id);
  return {
    ...board,
    pins: exists ? board.pins.map((candidate) => (candidate.id === pin.id ? pin : candidate)) : [...board.pins, pin],
  };
}

/** The map with one link changed. */
export function updateLink(board: GeoBoard, linkId: string, patch: Partial<GeoLink>): GeoBoard {
  return { ...board, links: board.links.map((link) => (link.id === linkId ? { ...link, ...patch } : link)) };
}

/** The map without a link. */
export function removeLink(board: GeoBoard, linkId: string): GeoBoard {
  return { ...board, links: board.links.filter((link) => link.id !== linkId) };
}

/** The map without an area or pin, and without every link touching it. */
export function removeItem(board: GeoBoard, ref: GeoItemRef): GeoBoard {
  const touches = (end: GeoLinkEnd) => (ref.kind === 'area' ? end.areaId : end.pinId) === ref.id;
  return {
    areas: ref.kind === 'area' ? board.areas.filter((area) => area.id !== ref.id) : board.areas,
    pins: ref.kind === 'pin' ? board.pins.filter((pin) => pin.id !== ref.id) : board.pins,
    links: board.links.filter((link) => !touches(link.from) && !touches(link.to)),
  };
}
