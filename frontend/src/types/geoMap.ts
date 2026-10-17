import type { ArrowDirection, MapColor, MapDocument, RelationshipMap } from './map';

/** Which side of its point a pin's name is written on (spec 38 Decision 4). */
export type LabelSide = 'left' | 'right' | 'above' | 'below';

/** A corner of an area, in plane units: `[x, y]`, the origin top left. */
export type Corner = [number, number];

/**
 * A zone of a geographic map (Decision 3): a closed shape through `points`.
 * Bound to a Document (`documentId`), its name and subtitle follow it; a
 * plain one carries its own `name`, `subtitle` and `note`.
 */
export interface GeoArea {
  id: string;
  documentId: string | null;
  name: string | null;
  subtitle: string | null;
  note: string | null;
  points: Corner[];
  color: MapColor;
  /** A "proposed" zone, drawn with a dashed outline. */
  dashed: boolean;
  /** Filled with its color, or outline only. */
  filled: boolean;
  masterOnly: boolean;
  /** The Document's look, on a Document's area. */
  document: MapDocument | null;
}

/**
 * A place of a geographic map (Decision 4): a point, drawn as a diamond when
 * bound to a Document and as a circle when plain.
 */
export interface GeoPin {
  id: string;
  documentId: string | null;
  name: string | null;
  note: string | null;
  x: number;
  y: number;
  labelSide: LabelSide;
  color: MapColor;
  masterOnly: boolean;
  document: MapDocument | null;
}

/** One end of a link: an area or a pin. */
export interface GeoLinkEnd {
  areaId: string | null;
  pinId: string | null;
}

/**
 * A link between two areas or pins (Decision 5): a free map's arrow, drawn
 * as a dashed curve. `bend` is how far the curve's middle leaves the
 * straight line, in plane units, to its left going from `from` to `to`;
 * null for the default curve.
 */
export interface GeoLink {
  id: string;
  from: GeoLinkEnd;
  to: GeoLinkEnd;
  direction: ArrowDirection;
  label: string | null;
  reverseLabel: string | null;
  bend: number | null;
  labelPosition: number | null;
  reverseLabelPosition: number | null;
  labelOffset: number | null;
  reverseLabelOffset: number | null;
  color: MapColor;
  masterOnly: boolean;
}

/** Everything on a geographic map the viewer sees. */
export interface GeoBoard {
  areas: GeoArea[];
  pins: GeoPin[];
  links: GeoLink[];
}

/** A geographic map with its plane, background and content (spec 38). */
export interface GeoMapDetail extends RelationshipMap, GeoBoard {
  planeWidth: number;
  planeHeight: number;
  /** A short-lived signed link to the background image, if it has one. */
  backgroundUrl: string | null;
}
