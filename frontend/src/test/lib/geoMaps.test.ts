import { describe, expect, it } from 'vitest';
import {
  MAX_AREA_POINTS,
  MAX_BEND,
  PARALLEL_BEND,
  DEFAULT_BEND_RATIO,
  MAX_ZOOM,
  MIN_ZOOM,
  addLink,
  areaCenter,
  arrowHead,
  bendThrough,
  clampToPlane,
  curvePath,
  endPoint,
  endRef,
  findItem,
  placeConnections,
  placeOfDocument,
  fitView,
  insertCorner,
  insideShape,
  placeAreaLabels,
  textWidth,
  isDimmed,
  linkBend,
  linkCurve,
  linkGeometry,
  moveCorner,
  moveCorners,
  newArea,
  newPin,
  outlineExit,
  placeName,
  placeSubtitle,
  placedDocumentIds,
  pointOnCurve,
  polygonSurface,
  putArea,
  putPin,
  removeCorner,
  removeItem,
  removeLink,
  stopShort,
  toGeoBody,
  toGeoMapDetail,
  toPlane,
  updateLink,
  zoomAt,
  type RawGeoMapDetail,
} from '../../lib/geoMaps';
import type { Corner, GeoLink } from '../../types/geoMap';
import { rawGeoMapDetail, rawImage } from '../fixtures';

function detail(overrides: Record<string, unknown> = {}) {
  return toGeoMapDetail(rawGeoMapDetail(overrides) as unknown as RawGeoMapDetail);
}

const square: Corner[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe('the wire shape', () => {
  it('reads a geographic map with its plane, background and content', () => {
    const map = detail({ background_url: 'https://cdn/bg.webp' });
    expect(map).toMatchObject({ kind: 'geographic', planeWidth: 2000, planeHeight: 1400, backgroundUrl: 'https://cdn/bg.webp' });
    expect(map.areas[0]).toMatchObject({
      documentId: 'doc-1',
      points: [
        [100, 100],
        [500, 100],
        [500, 400],
        [100, 400],
      ],
      document: { name: 'Incrocio', subtitle: 'Il cuore', tagIds: ['tag-1'], image: null },
    });
    expect(map.areas[1]).toMatchObject({ name: 'Il bosco', dashed: true, filled: false, document: null });
    expect(map.pins[0]).toMatchObject({ labelSide: 'left', color: 'gold', document: { name: 'Shibuya Sky' } });
    expect(map.pins[1]).toMatchObject({ name: 'Shibuya 109', masterOnly: true });
    expect(map.links[0]).toMatchObject({
      from: { areaId: null, pinId: 'pin-1' },
      to: { areaId: null, pinId: 'pin-2' },
      bend: -80,
      label: 'la finestra',
    });
  });

  it("reads a Document's image on its place", () => {
    const raw = rawGeoMapDetail();
    raw.pins[0].document = { ...raw.pins[0].document!, image: rawImage() } as never;
    const map = toGeoMapDetail(raw as unknown as RawGeoMapDetail);
    expect(map.pins[0].document?.image).not.toBeNull();
  });

  it('sends the revision the map started from (spec 42)', () => {
    expect(toGeoBody({ areas: [], pins: [], links: [] }, 4)).toEqual({ base_revision: 4, areas: [], pins: [], links: [] });
  });

  it("sends no texts of their own for a Document's places, and no reverse label one way", () => {
    const map = detail();
    const body = toGeoBody({
      areas: [{ ...map.areas[0], name: 'stale', masterOnly: true }, map.areas[1]],
      pins: [{ ...map.pins[0], note: 'stale', masterOnly: true }, map.pins[1]],
      links: [{ ...map.links[0], reverseLabel: 'kept out', reverseLabelPosition: 0.2, reverseLabelOffset: 4 }],
    });
    expect(body.areas[0]).toMatchObject({ document_id: 'doc-1', name: null, subtitle: null, note: null, master_only: false });
    expect(body.areas[1]).toMatchObject({ name: 'Il bosco', subtitle: 'Sacro', note: 'Nessuno lo controlla.', dashed: true });
    expect(body.pins[0]).toMatchObject({ name: null, note: null, master_only: false, label_side: 'left' });
    expect(body.pins[1]).toMatchObject({ name: 'Shibuya 109', master_only: true });
    expect(body.links[0]).toMatchObject({
      from_end: { area_id: null, pin_id: 'pin-1' },
      reverse_label: null,
      reverse_label_position: null,
      reverse_label_offset: null,
      bend: -80,
    });
  });

  it('sends both labels of a two-way link', () => {
    const map = detail();
    const body = toGeoBody({
      ...map,
      links: [{ ...map.links[0], direction: 'both', reverseLabel: 'e ritorno', reverseLabelPosition: 0.2, reverseLabelOffset: 4 }],
    });
    expect(body.links[0]).toMatchObject({ reverse_label: 'e ritorno', reverse_label_position: 0.2, reverse_label_offset: 4 });
  });
});

describe('reading a map', () => {
  const map = detail();

  it("names a place after its Document, else its own name, else nothing", () => {
    expect(placeName(map.areas[0])).toBe('Incrocio');
    expect(placeName(map.pins[1])).toBe('Shibuya 109');
    expect(placeName({ ...map.pins[1], name: null })).toBe('');
    expect(placeSubtitle(map.areas[0])).toBe('Il cuore');
    expect(placeSubtitle(map.areas[1])).toBe('Sacro');
  });

  it('lists the Documents placed on the map', () => {
    expect(placedDocumentIds(map)).toEqual(new Set(['doc-1', 'doc-2']));
  });

  it('finds an area or a pin, and the item a link end names', () => {
    expect(findItem(map, { kind: 'area', id: 'area-2' })?.name).toBe('Il bosco');
    expect(findItem(map, { kind: 'pin', id: 'pin-2' })?.name).toBe('Shibuya 109');
    expect(findItem(map, { kind: 'pin', id: 'gone' })).toBeUndefined();
    expect(endRef({ areaId: 'area-1', pinId: null })).toEqual({ kind: 'area', id: 'area-1' });
    expect(endRef({ areaId: null, pinId: 'pin-1' })).toEqual({ kind: 'pin', id: 'pin-1' });
  });

  it("finds where a Document is placed, if it is (spec 50)", () => {
    expect(placeOfDocument(map, 'doc-1')).toEqual({ kind: 'area', id: 'area-1' });
    expect(placeOfDocument(map, 'doc-2')).toEqual({ kind: 'pin', id: 'pin-1' });
    expect(placeOfDocument(map, 'doc-9')).toBeNull();
  });

  it("lists a place's links, labelled from its side, skipping a gone end (spec 50)", () => {
    const link = map.links[0];
    const board = {
      ...map,
      links: [
        link,
        { ...link, id: 'link-2', from: { areaId: 'area-2', pinId: null }, reverseLabel: 'il ritorno' },
        { ...link, id: 'link-3', to: { areaId: null, pinId: 'gone' } },
      ],
    };
    expect(placeConnections(board, { kind: 'pin', id: 'pin-1' })).toEqual([
      { linkId: 'link-1', item: map.pins[1], ref: { kind: 'pin', id: 'pin-2' }, label: 'la finestra' },
    ]);
    expect(placeConnections(board, { kind: 'pin', id: 'pin-2' })).toEqual([
      { linkId: 'link-1', item: map.pins[0], ref: { kind: 'pin', id: 'pin-1' }, label: 'la finestra' },
      { linkId: 'link-2', item: map.areas[1], ref: { kind: 'area', id: 'area-2' }, label: 'il ritorno' },
    ]);
    expect(placeConnections(board, { kind: 'area', id: 'area-1' })).toEqual([]);
  });

  it('dims what has no Document with the filtered Tag (Decision 8)', () => {
    expect(isDimmed(map.areas[0], null)).toBe(false);
    expect(isDimmed(map.areas[0], 'tag-1')).toBe(false);
    expect(isDimmed(map.pins[0], 'tag-1')).toBe(true);
    expect(isDimmed(map.areas[1], 'tag-1')).toBe(true);
  });
});

describe('geometry', () => {
  it('measures a shape and finds its center', () => {
    expect(polygonSurface(square)).toBe(100);
    expect(areaCenter(square)).toEqual({ x: 5, y: 5 });
    // A shape with no surface falls back to the average of its corners.
    expect(
      areaCenter([
        [0, 0],
        [6, 0],
        [3, 0],
      ]),
    ).toEqual({ x: 3, y: 0 });
  });

  it('keeps points and shapes inside the plane', () => {
    expect(clampToPlane({ x: -5, y: 50 }, 40, 30)).toEqual({ x: 0, y: 30 });
    expect(moveCorners(square, 100, -100, 30, 30)).toEqual([
      [20, 0],
      [30, 0],
      [30, 10],
      [20, 10],
    ]);
    expect(moveCorner(square, 2, { x: 99, y: 4 }, 50, 50)[2]).toEqual([50, 4]);
  });

  it('adds a corner in the middle of a side, up to the cap', () => {
    expect(insertCorner(square, 3)).toEqual([...square, [0, 5]]);
    const full = Array.from({ length: MAX_AREA_POINTS }, (_, i): Corner => [i, i % 2]);
    expect(insertCorner(full, 0)).toBe(full);
  });

  it('removes a corner, never below three', () => {
    expect(removeCorner(square, 0)).toEqual(square.slice(1));
    const triangle = square.slice(1);
    expect(removeCorner(triangle, 0)).toBe(triangle);
  });

  it('places link ends on pins and area centers', () => {
    const map = detail();
    expect(endPoint(map, { areaId: null, pinId: 'pin-1' })).toEqual({ x: 300, y: 250 });
    expect(endPoint(map, { areaId: 'area-1', pinId: null })).toEqual({ x: 300, y: 250 });
    expect(endPoint(map, { areaId: null, pinId: 'gone' })).toBeUndefined();
    expect(endPoint(map, { areaId: 'gone', pinId: null })).toBeUndefined();
  });

  it('bends a link by its own bend, else a default spread apart for shared ends', () => {
    const base = detail().links[0];
    const a: GeoLink = { ...base, id: 'a', bend: null };
    const b: GeoLink = { ...base, id: 'b', bend: null, from: base.to, to: base.from };
    const links = [a, b, base];
    expect(linkBend(links, base, 100)).toBe(-80);
    expect(linkBend(links, a, 100)).toBe(100 * DEFAULT_BEND_RATIO);
    expect(linkBend(links, b, 100)).toBe(100 * DEFAULT_BEND_RATIO + PARALLEL_BEND);
  });

  it('draws a curve whose middle sits the bend off the line', () => {
    const curve = linkCurve({ x: 0, y: 0 }, { x: 100, y: 0 }, 20);
    expect(pointOnCurve(curve, 0.5)).toEqual({ x: 50, y: 20 });
    expect(pointOnCurve(curve, 0)).toEqual({ x: 0, y: 0 });
    expect(curvePath(curve)).toBe('M 0,0 Q 50,40 100,0');
    expect(bendThrough({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 20.4 })).toBe(20);
    expect(bendThrough({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: -1e9 })).toBe(-MAX_BEND);
    expect(bendThrough({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 3000 })).toBe(3000);
    expect(bendThrough({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 50, y: 20 })).toBe(0);
  });

  it('draws an arrowhead at the tip, and stops short of a pin', () => {
    expect(arrowHead({ x: 0, y: 0 }, { x: 10, y: 0 }, 4)).toBe('10,0 6,2 6,-2');
    // Ends at one point: a flat arrowhead, never a division by zero.
    expect(arrowHead({ x: 3, y: 3 }, { x: 3, y: 3 }, 2)).toBe('3,3 3,3 3,3');
    expect(stopShort({ x: 0, y: 0 }, { x: 10, y: 0 }, 4)).toEqual({ x: 6, y: 0 });
    expect(stopShort({ x: 0, y: 0 }, { x: 3, y: 0 }, 4)).toEqual({ x: 3, y: 0 });
  });

  it('meets an area on its outline', () => {
    expect(outlineExit(square, { x: 5, y: 5 }, { x: 25, y: 5 })).toEqual({ x: 10, y: 5 });
    // A segment that never leaves the shape stays at the center.
    expect(outlineExit(square, { x: 5, y: 5 }, { x: 6, y: 5 })).toEqual({ x: 5, y: 5 });
    // In a notched shape the segment crosses the outline twice: the nearer counts.
    const notched: Corner[] = [
      [0, 0],
      [30, 0],
      [30, 10],
      [20, 10],
      [20, 5],
      [10, 5],
      [10, 10],
      [0, 10],
    ];
    expect(outlineExit(notched, { x: 25, y: 8 }, { x: 5, y: 8 })).toEqual({ x: 20, y: 8 });
    expect(outlineExit(notched, { x: 5, y: 8 }, { x: 25, y: 8 })).toEqual({ x: 10, y: 8 });
    // A side parallel to the segment is skipped.
    expect(outlineExit(square, { x: 5, y: 0 }, { x: 5, y: 20 })).toEqual({ x: 5, y: 10 });
  });

  it('draws a link from an area outline to short of a pin, or nothing when an end is gone', () => {
    const map = detail();
    const link: GeoLink = { ...map.links[0], from: { areaId: 'area-2', pinId: null }, bend: 0 };
    const geometry = linkGeometry(map, link, 10)!;
    expect(geometry.to).toEqual({ x: 800, y: 700 });
    expect(Math.hypot(geometry.curve.to.x - 800, geometry.curve.to.y - 700)).toBeCloseTo(10);
    expect(geometry.curve.from.y).toBeGreaterThan(geometry.from.y);
    expect(linkGeometry(map, { ...link, to: { areaId: null, pinId: 'gone' } }, 10)).toBeUndefined();
  });
});

describe('the view', () => {
  it('fits the plane in the box, centered', () => {
    expect(fitView(1000, 500, 1000, 1000)).toEqual({ x: 25, y: 262.5, k: 0.95 });
    expect(fitView(1e9, 1e9, 10, 10).k).toBe(MIN_ZOOM);
  });

  it('zooms around a point that stays put, within the limits', () => {
    const view = zoomAt({ x: 0, y: 0, k: 1 }, 2, { x: 100, y: 50 });
    expect(view).toEqual({ x: -100, y: -50, k: 2 });
    expect(toPlane(view, { x: 100, y: 50 })).toEqual({ x: 100, y: 50 });
    expect(zoomAt({ x: 0, y: 0, k: 1 }, 1000, { x: 0, y: 0 }).k).toBe(MAX_ZOOM);
  });
});

describe('editing a map', () => {
  it('makes plain areas and pins waiting for a name', () => {
    expect(newArea(square)).toMatchObject({ documentId: null, name: null, points: square, filled: true, dashed: false });
    expect(newPin({ x: 10.4, y: 20.6 })).toMatchObject({ x: 10, y: 21, labelSide: 'right', documentId: null });
    expect(newArea(square).id).not.toBe(newArea(square).id);
  });

  it('adds, replaces and removes areas, pins and links', () => {
    const map = detail();
    const [linked, linkId] = addLink(map, { kind: 'area', id: 'area-1' }, { kind: 'pin', id: 'pin-2' });
    expect(linked.links.at(-1)).toMatchObject({
      id: linkId,
      from: { areaId: 'area-1', pinId: null },
      to: { areaId: null, pinId: 'pin-2' },
      direction: 'forward',
      bend: null,
    });
    expect(updateLink(linked, linkId, { label: 'guarda' }).links.at(-1)?.label).toBe('guarda');
    expect(updateLink(linked, linkId, { label: 'guarda' }).links[0]).toBe(linked.links[0]);
    expect(removeLink(linked, linkId).links).toHaveLength(1);

    const area = newArea(square);
    expect(putArea(map, area).areas).toHaveLength(3);
    expect(putArea(map, { ...map.areas[1], name: 'Bosco' }).areas[1].name).toBe('Bosco');
    const pin = newPin({ x: 1, y: 1 });
    expect(putPin(map, pin).pins).toHaveLength(3);
    expect(putPin(map, { ...map.pins[0], x: 5 }).pins[0].x).toBe(5);
  });

  it('removes an item with every link touching it', () => {
    const map = detail();
    const [linked] = addLink(map, { kind: 'area', id: 'area-1' }, { kind: 'area', id: 'area-2' });
    const withoutPin = removeItem(linked, { kind: 'pin', id: 'pin-1' });
    expect(withoutPin.pins.map((pin) => pin.id)).toEqual(['pin-2']);
    expect(withoutPin.links).toHaveLength(1);
    const withoutArea = removeItem(linked, { kind: 'area', id: 'area-2' });
    expect(withoutArea.areas.map((area) => area.id)).toEqual(['area-1']);
    expect(withoutArea.links.map((link) => link.id)).toEqual(['link-1']);
  });
});

describe('area names kept clear of other labels (spec 38b)', () => {
  const square: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const label = { id: 'a', points: square, width: 30, above: 5, below: 5 };

  it('tells inside from outside a shape', () => {
    expect(insideShape({ x: 50, y: 50 }, square)).toBe(true);
    expect(insideShape({ x: 150, y: 50 }, square)).toBe(false);
    expect(textWidth('abcd', 10)).toBeCloseTo(23.2);
  });

  it('keeps a name at the centroid when nothing is there', () => {
    expect(placeAreaLabels([label], [{ x: 0, y: 0, width: 10, height: 10 }]).get('a')).toEqual({ x: 50, y: 50 });
  });

  it('moves a name off what covers the centroid, staying inside the area', () => {
    const at = placeAreaLabels([label], [{ x: 30, y: 40, width: 40, height: 20 }]).get('a')!;
    expect(Math.abs(at.y - 50)).toBeGreaterThanOrEqual(10);
    expect(insideShape(at, square)).toBe(true);
  });

  it('keeps two names apart', () => {
    const placed = placeAreaLabels([label, { ...label, id: 'b' }], []);
    const [a, b] = [placed.get('a')!, placed.get('b')!];
    expect(Math.abs(a.x - b.x) >= 30 || Math.abs(a.y - b.y) >= 10).toBe(true);
  });

  it('uses the centroid of an area too narrow for any grid point', () => {
    const sliver: [number, number][] = [[0, 0], [100, 0], [0, 0.0001]];
    expect(placeAreaLabels([{ ...label, points: sliver }], []).get('a')).toBeDefined();
    const line: [number, number][] = [[0, 0], [0, 0], [0, 0]];
    expect(placeAreaLabels([{ ...label, points: line }], []).get('a')).toEqual({ x: 0, y: 0 });
  });
});
