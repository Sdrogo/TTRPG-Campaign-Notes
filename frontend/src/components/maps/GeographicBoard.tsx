import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ActionIcon,
  Box,
  Button,
  CloseButton,
  Group,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { ArrowsInIcon, CheckIcon, MinusIcon, PencilSimpleIcon, PlusIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useBackState } from '../../lib/backNav';
import { canClose, clickDraft, startDraft, undoCorner, type AreaDraft } from '../../lib/areaDraw';
import {
  addLink,
  areaCenter,
  arrowHead,
  bendThrough,
  clampToPlane,
  curvePath,
  endPoint,
  endRef,
  findItem,
  fitView,
  insertCorner,
  isDimmed,
  linkGeometry,
  moveCorner,
  moveCorners,
  newArea,
  newPin,
  placeAreaLabels,
  placeName,
  placeSubtitle,
  placedDocumentIds,
  pointOnCurve,
  putArea,
  putPin,
  removeCorner,
  removeItem,
  removeLink,
  textWidth,
  toPlane,
  updateLink,
  zoomAt,
  type LabelBox,
  type Curve,
  type GeoItemRef,
  type View,
} from '../../lib/geoMaps';
import { colorValue, pointBeside, type Point } from '../../lib/maps';
import type { Document } from '../../types/document';
import type { GeoArea, GeoBoard, GeoLink, GeoPin, LabelSide } from '../../types/geoMap';
import type { Tag } from '../../types/tag';
import { ArrowDialog } from './ArrowDialog';
import { AreaDialog } from './AreaDialog';
import { PinDialog } from './PinDialog';

/** What the board measures before it is laid out (and in tests, where nothing is). */
const FALLBACK_SIZE = { width: 800, height: 600 };
/** How far, in screen pixels, a press moves before it is a drag and not a click. */
const DRAG_THRESHOLD = 4;
/** Screen sizes of what stays the same size whatever the zoom. */
const PIN_RADIUS = 7;
const HANDLE_SIZE = 9;
const AREA_FONT = 14;
const LABEL_FONT = 12;
/** How much one press of a zoom button zooms. */
const ZOOM_STEP = 1.25;

type Tool = 'select' | 'area' | 'pin' | 'link';

/**
 * A press on the board, until it is released: `pan` moves the view (and is a
 * click on `click` or the plane when it doesn't move), the others drag an
 * item, a corner or a link's bend while editing.
 */
type Drag =
  | { kind: 'pan'; start: Point; view: View; moved: boolean; click: GeoItemRef | null }
  | { kind: 'item'; ref: GeoItemRef; start: Point; moved: boolean }
  | { kind: 'corner'; areaId: string; index: number; start: Point; moved: boolean }
  | { kind: 'bend'; linkId: string; start: Point; moved: boolean };

type Editing =
  | { kind: 'area'; area: GeoArea; isNew: boolean }
  | { kind: 'pin'; pin: GeoPin; isNew: boolean }
  | { kind: 'link'; id: string }
  | null;

export interface GeographicBoardProps {
  roomId: string;
  board: GeoBoard;
  planeWidth: number;
  planeHeight: number;
  backgroundUrl: string | null;
  /**
   * Whether the viewer may change the map here: false on a phone, for a
   * member who can't change it, and in "View as". The board still opens for
   * reading; "Modifica la mappa" switches it to editing (spec 38b).
   */
  editable: boolean;
  isMaster: boolean;
  /** The Room's Documents the viewer sees, for binding an area or pin. */
  documents: Document[];
  /** The Room's Tags, for the filter (Decision 8). */
  tags: Tag[];
  onChange: (board: GeoBoard) => void;
  /** Given where the split pane fits (spec 38b): a click on a Document's area or pin shows it there. */
  onSelectDocument?: (documentId: string) => void;
  /** The board's height; the full page's by default. */
  height?: string | number;
}

/** Where a pin's name sits, from its point, in screen pixels, and how it is anchored. */
function labelPlacement(side: LabelSide): {
  dx: number;
  dy: number;
  anchor: 'start' | 'middle' | 'end';
  baseline: 'central' | 'auto' | 'hanging';
} {
  const gap = PIN_RADIUS + 5;
  switch (side) {
    case 'left':
      return { dx: -gap, dy: 0, anchor: 'end', baseline: 'central' };
    case 'above':
      return { dx: 0, dy: -gap, anchor: 'middle', baseline: 'auto' };
    case 'below':
      return { dx: 0, dy: gap, anchor: 'middle', baseline: 'hanging' };
    default:
      return { dx: gap, dy: 0, anchor: 'start', baseline: 'central' };
  }
}

/**
 * A geographic map (spec 38): the plane with its background, the areas, the
 * links and the pins, in one SVG the viewer pans (drag) and zooms (wheel or
 * buttons). It opens for reading (spec 38b): a click on a Document's area or
 * pin shows the Document in the split pane, on any other its card; the Tag
 * filter dims what lacks the Tag. Area names move off pins and labels.
 * After "Modifica la mappa": draw an area corner by corner, place a pin, link
 * two items, drag pins, areas, corners and a link's curve, edit a place from
 * its card, Delete to remove what is selected. Every change goes out through
 * `onChange` as the whole map.
 */
export function GeographicBoard({
  roomId,
  board,
  planeWidth,
  planeHeight,
  backgroundUrl,
  editable,
  isMaster,
  documents,
  tags,
  onChange,
  onSelectDocument,
  height = 'calc(100dvh - 190px)',
}: GeographicBoardProps) {
  const { t } = useTranslation();
  const backState = useBackState();
  const wrapper = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  // The board's size on screen, followed as it changes.
  const [box, setBox] = useState(FALLBACK_SIZE);
  // Null while the whole plane is shown, as on opening; set once panned or zoomed.
  const [moved, setMoved] = useState<View | null>(null);
  const view = moved ?? fitView(planeWidth, planeHeight, box.width, box.height);
  // The map opens for reading; editing is asked for (spec 38b).
  const [editMode, setEditMode] = useState(false);
  const canEdit = editable && editMode;
  const [tool, setTool] = useState<Tool>('select');
  const [draft, setDraft] = useState<AreaDraft | null>(null);
  const [linkStart, setLinkStart] = useState<GeoItemRef | null>(null);
  const [selected, setSelected] = useState<GeoItemRef | { kind: 'link'; id: string } | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [tagId, setTagId] = useState<string | null>(null);
  // What a drag shows until it is dropped, when it becomes a change.
  const [preview, setPreview] = useState<GeoBoard | null>(null);
  const drag = useRef<Drag | null>(null);
  // The wheel listener lives outside React's renders: it reads the view here.
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });
  const shown = preview ?? board;
  const s = 1 / view.k;

  // A new plane size shows the whole plane again.
  const [plane, setPlane] = useState({ planeWidth, planeHeight });
  if (plane.planeWidth !== planeWidth || plane.planeHeight !== planeHeight) {
    setPlane({ planeWidth, planeHeight });
    setMoved(null);
  }

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setBox({ width, height });
    });
    observer.observe(wrapper.current!);
    return () => observer.disconnect();
  }, []);

  // The wheel zooms around the pointer; React's own wheel listener is
  // passive, so it couldn't keep the page from scrolling.
  useEffect(() => {
    const element = svg.current!;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setMoved(zoomAt(viewRef.current, Math.exp(-event.deltaY * 0.0015), at));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const local = (event: React.PointerEvent | React.MouseEvent): Point => {
    const rect = svg.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const planePoint = (event: React.PointerEvent | React.MouseEvent) => toPlane(view, local(event));

  const shaping = canEdit && tool === 'select';
  const taken = placedDocumentIds(board);

  // --- Clicks ---------------------------------------------------------------

  const clickPlane = (at: Point) => {
    if (tool === 'area') {
      const step = clickDraft(draft ?? startDraft(), clampToPlane(at, planeWidth, planeHeight), HANDLE_SIZE * s);
      if (step.closed) {
        setDraft(null);
        setTool('select');
        setEditing({ kind: 'area', area: newArea(step.closed), isNew: true });
      } else {
        setDraft(step.draft);
      }
    } else if (tool === 'pin') {
      setEditing({ kind: 'pin', pin: newPin(clampToPlane(at, planeWidth, planeHeight)), isNew: true });
    } else if (tool === 'link') {
      // The empty plane drops a link's first end.
      setLinkStart(null);
    } else {
      setSelected(null);
    }
  };

  const clickItem = (ref: GeoItemRef, at: Point) => {
    if (tool === 'area' || tool === 'pin') {
      // Drawing goes on over an area or pin: the click lands on the plane.
      clickPlane(at);
    } else if (tool === 'link') {
      if (!linkStart) {
        setLinkStart(ref);
      } else if (linkStart.id !== ref.id) {
        const [next, linkId] = addLink(board, linkStart, ref);
        onChange(next);
        setLinkStart(null);
        setEditing({ kind: 'link', id: linkId });
      }
    } else {
      setSelected(ref);
      const documentId = findItem(board, ref)!.documentId;
      if (documentId) onSelectDocument?.(documentId);
    }
  };

  // --- Presses and drags ----------------------------------------------------

  const press = (event: React.PointerEvent, next: Drag) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    svg.current!.setPointerCapture?.(event.pointerId);
    drag.current = next;
  };

  const pressPlane = (event: React.PointerEvent) =>
    press(event, { kind: 'pan', start: local(event), view, moved: false, click: null });

  const pressItem = (event: React.PointerEvent, ref: GeoItemRef) =>
    press(
      event,
      shaping
        ? { kind: 'item', ref, start: local(event), moved: false }
        : { kind: 'pan', start: local(event), view, moved: false, click: ref },
    );

  const move = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current) return;
    const at = local(event);
    const dx = at.x - current.start.x;
    const dy = at.y - current.start.y;
    if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    current.moved = true;
    if (current.kind === 'pan') {
      setMoved({ ...current.view, x: current.view.x + dx, y: current.view.y + dy });
    } else if (current.kind === 'item') {
      const item = findItem(board, current.ref)!;
      setPreview(
        current.ref.kind === 'area'
          ? putArea(board, { ...(item as GeoArea), points: moveCorners((item as GeoArea).points, dx * s, dy * s, planeWidth, planeHeight) })
          : putPin(board, {
              ...(item as GeoPin),
              ...roundPoint(clampToPlane({ x: (item as GeoPin).x + dx * s, y: (item as GeoPin).y + dy * s }, planeWidth, planeHeight)),
            }),
      );
    } else if (current.kind === 'corner') {
      const area = board.areas.find((candidate) => candidate.id === current.areaId)!;
      setPreview(
        putArea(board, { ...area, points: moveCorner(area.points, current.index, roundPoint(toPlane(view, at)), planeWidth, planeHeight) }),
      );
    } else {
      const link = board.links.find((candidate) => candidate.id === current.linkId)!;
      const from = endPoint(board, link.from)!;
      const to = endPoint(board, link.to)!;
      setPreview(updateLink(board, link.id, { bend: bendThrough(from, to, toPlane(view, at)) }));
    }
  };

  const release = (event: React.PointerEvent) => {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    if (current.moved) {
      // A drag of the view changes nothing on the map; any other is dropped.
      if (current.kind !== 'pan') {
        onChange(preview!);
        setPreview(null);
      }
      return;
    }
    // A still press is a click: on an item (whether or not it could be
    // dragged), or on the plane; a still press on a handle does nothing.
    if (current.kind === 'item') clickItem(current.ref, planePoint(event));
    else if (current.kind === 'pan' && current.click) clickItem(current.click, planePoint(event));
    else if (current.kind === 'pan') clickPlane(planePoint(event));
  };

  const cancel = () => {
    drag.current = null;
    setPreview(null);
  };

  // --- Keys and tools -------------------------------------------------------

  const chooseTool = (next: Tool) => {
    setTool(next);
    setDraft(null);
    setLinkStart(null);
    setSelected(null);
  };

  const stopEditing = () => {
    chooseTool('select');
    setEditMode(false);
  };

  const handleKey = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      chooseTool('select');
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && canEdit && selected) {
      onChange(selected.kind === 'link' ? removeLink(board, selected.id) : removeItem(board, selected));
      setSelected(null);
    }
  };

  // --- Drawing --------------------------------------------------------------

  const itemOpacity = (item: GeoArea | GeoPin) => (isDimmed(item, tagId) ? 0.2 : item.masterOnly ? 0.65 : 1);
  const isSelected = (kind: string, id: string) =>
    (selected?.kind === kind && selected.id === id) || (linkStart?.kind === kind && linkStart.id === id);
  const halo = { stroke: 'var(--bg-base)', strokeWidth: 3 * s, paintOrder: 'stroke' as const };

  const linkShapes = shown.links.flatMap((link) => {
    const geometry = linkGeometry(shown, link, (PIN_RADIUS + 3) * s);
    return geometry ? [{ link, ...geometry }] : [];
  });

  const openLink = (link: GeoLink) => {
    if (!canEdit) return;
    setSelected({ kind: 'link', id: link.id });
    setEditing({ kind: 'link', id: link.id });
  };

  const selectedItem = selected && selected.kind !== 'link' ? findItem(board, selected) : undefined;
  // A Document's place shows in the split pane; its card is for editing it,
  // or where there is no pane (spec 38b).
  const showCard = canEdit || !selectedItem?.documentId || !onSelectDocument;
  const selectedArea = selected?.kind === 'area' && shaping ? shown.areas.find((area) => area.id === selected.id) : undefined;
  const selectedLink = selected?.kind === 'link' && shaping ? linkShapes.find((shape) => shape.link.id === selected.id) : undefined;
  const editedLink = editing?.kind === 'link' ? board.links.find((link) => link.id === editing.id) : undefined;
  const nameOfEnd = (end: GeoLink['from']) => placeName(findItem(board, endRef(end))!);
  const close = () => setEditing(null);

  // Area names are placed on the saved map, at this zoom (spec 38b): while
  // a drag shows a change, an area's name moves with it and the others stay.
  // The zoom is deferred, so a full map's placement never holds up a wheel step.
  const labelZoom = useDeferredValue(s);
  const placedLabels = useMemo(() => areaLabelPoints(board, labelZoom), [board, labelZoom]);
  const labelPoint = (area: GeoArea) => {
    const placed = placedLabels.get(area.id)!;
    const saved = board.areas.find((candidate) => candidate.id === area.id)!;
    if (saved === area) return placed;
    const [now, before] = [areaCenter(area.points), areaCenter(saved.points)];
    return { x: placed.x + now.x - before.x, y: placed.y + now.y - before.y };
  };

  return (
    <Box
      ref={wrapper}
      h={height}
      mih={300}
      pos="relative"
      style={{
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--mantine-radius-lg)',
        overflow: 'hidden',
        background: 'var(--bg-base)',
      }}
    >
      <svg
        ref={svg}
        role="application"
        aria-label={t('maps.geo.board')}
        tabIndex={0}
        width="100%"
        height="100%"
        style={{ display: 'block', touchAction: 'none', cursor: tool === 'select' ? 'grab' : 'crosshair', outline: 'none' }}
        onPointerDown={pressPlane}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={cancel}
        onKeyDown={handleKey}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <rect
            x={0}
            y={0}
            width={planeWidth}
            height={planeHeight}
            fill="var(--bg-surface)"
            stroke="var(--border-default)"
            strokeWidth={s}
          />
          {backgroundUrl && (
            <image
              href={backgroundUrl}
              x={0}
              y={0}
              width={planeWidth}
              height={planeHeight}
              preserveAspectRatio="none"
              style={{ pointerEvents: 'none' }}
            />
          )}
          {shown.areas.map((area) => {
            const color = colorValue(area.color);
            return (
              <polygon
                key={area.id}
                role="button"
                aria-label={placeName(area)}
                aria-pressed={isSelected('area', area.id)}
                points={area.points.map(([x, y]) => `${x},${y}`).join(' ')}
                fill={color}
                fillOpacity={area.filled ? 0.22 : 0}
                stroke={color}
                strokeWidth={(isSelected('area', area.id) ? 4 : 2) * s}
                strokeDasharray={area.dashed ? `${10 * s} ${7 * s}` : undefined}
                strokeLinejoin="round"
                opacity={itemOpacity(area)}
                style={{ cursor: shaping ? 'move' : 'pointer' }}
                onPointerDown={(event) => pressItem(event, { kind: 'area', id: area.id })}
              />
            );
          })}
          {linkShapes.map(({ link, curve, from, to }) => {
            const color = colorValue(link.color);
            const path = curvePath(curve);
            return (
              <g key={link.id} opacity={link.masterOnly ? 0.65 : 1}>
                <path
                  d={path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14 * s}
                  role="button"
                  aria-label={t('maps.geo.linkBetween', { from: nameOfEnd(link.from), to: nameOfEnd(link.to) })}
                  style={{ cursor: canEdit ? 'pointer' : 'default' }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => openLink(link)}
                />
                <path
                  d={path}
                  fill="none"
                  stroke={color}
                  strokeWidth={(isSelected('link', link.id) ? 3.5 : 2) * s}
                  strokeDasharray={`${7 * s} ${5 * s}`}
                  style={{ pointerEvents: 'none' }}
                />
                {link.direction !== 'none' && (
                  <polygon points={arrowHead(curve.control, curve.to, 12 * s)} fill={color} style={{ pointerEvents: 'none' }} />
                )}
                {link.direction === 'both' && (
                  <polygon points={arrowHead(curve.control, curve.from, 12 * s)} fill={color} style={{ pointerEvents: 'none' }} />
                )}
                {linkLabels(link, from, to, curve).map((label) => (
                  <text
                    key={label.key}
                    x={label.at.x}
                    y={label.at.y}
                    fontSize={LABEL_FONT * s}
                    fontStyle="italic"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={color}
                    {...halo}
                    style={{ cursor: canEdit ? 'pointer' : 'default', userSelect: 'none' }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => openLink(link)}
                  >
                    {label.text}
                  </text>
                ))}
              </g>
            );
          })}
          {shown.areas.map((area) => {
            const center = labelPoint(area);
            const subtitle = placeSubtitle(area);
            return (
              <g key={area.id} opacity={itemOpacity(area)} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                <text
                  x={center.x}
                  y={center.y}
                  fontSize={AREA_FONT * s}
                  fontWeight={700}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="var(--text-primary)"
                  {...halo}
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {placeName(area)}
                </text>
                {subtitle && (
                  <text
                    x={center.x}
                    y={center.y + AREA_FONT * 1.2 * s}
                    fontSize={LABEL_FONT * s}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="var(--text-muted)"
                    {...halo}
                  >
                    {subtitle}
                  </text>
                )}
              </g>
            );
          })}
          {shown.pins.map((pin) => {
            const color = colorValue(pin.color);
            const r = (isSelected('pin', pin.id) ? PIN_RADIUS + 3 : PIN_RADIUS) * s;
            const label = labelPlacement(pin.labelSide);
            return (
              <g
                key={pin.id}
                role="button"
                aria-label={placeName(pin)}
                aria-pressed={isSelected('pin', pin.id)}
                opacity={itemOpacity(pin)}
                style={{ cursor: shaping ? 'move' : 'pointer' }}
                onPointerDown={(event) => pressItem(event, { kind: 'pin', id: pin.id })}
              >
                {pin.documentId ? (
                  <polygon
                    points={`${pin.x},${pin.y - r} ${pin.x + r},${pin.y} ${pin.x},${pin.y + r} ${pin.x - r},${pin.y}`}
                    fill={color}
                    stroke="var(--bg-base)"
                    strokeWidth={2 * s}
                  />
                ) : (
                  <circle cx={pin.x} cy={pin.y} r={r * 0.85} fill={color} stroke="var(--bg-base)" strokeWidth={2 * s} />
                )}
                <text
                  x={pin.x + label.dx * s}
                  y={pin.y + label.dy * s}
                  fontSize={LABEL_FONT * s}
                  fontWeight={600}
                  textAnchor={label.anchor}
                  dominantBaseline={label.baseline}
                  fill="var(--text-primary)"
                  {...halo}
                  style={{ userSelect: 'none' }}
                >
                  {placeName(pin)}
                </text>
              </g>
            );
          })}
          {selectedArea &&
            selectedArea.points.map(([x, y], index) => {
              const [nx, ny] = selectedArea.points[(index + 1) % selectedArea.points.length];
              return (
                <g key={index}>
                  <circle
                    role="button"
                    aria-label={t('maps.geo.addCorner')}
                    cx={(x + nx) / 2}
                    cy={(y + ny) / 2}
                    r={(HANDLE_SIZE / 2) * s}
                    fill="var(--bg-base)"
                    stroke="var(--text-muted)"
                    strokeWidth={1.5 * s}
                    style={{ cursor: 'copy' }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      onChange(putArea(board, { ...selectedArea, points: insertCorner(selectedArea.points, index) }));
                    }}
                  />
                  <rect
                    role="button"
                    aria-label={t('maps.geo.corner', { number: index + 1 })}
                    x={x - (HANDLE_SIZE / 2) * s}
                    y={y - (HANDLE_SIZE / 2) * s}
                    width={HANDLE_SIZE * s}
                    height={HANDLE_SIZE * s}
                    fill="var(--text-primary)"
                    stroke="var(--bg-base)"
                    strokeWidth={1.5 * s}
                    style={{ cursor: 'grab' }}
                    onPointerDown={(event) =>
                      press(event, { kind: 'corner', areaId: selectedArea.id, index, start: local(event), moved: false })
                    }
                    onDoubleClick={() =>
                      onChange(putArea(board, { ...selectedArea, points: removeCorner(selectedArea.points, index) }))
                    }
                  />
                </g>
              );
            })}
          {selectedLink && (
            <circle
              role="button"
              aria-label={t('maps.geo.bend')}
              cx={pointOnCurve(selectedLink.curve, 0.5).x}
              cy={pointOnCurve(selectedLink.curve, 0.5).y}
              r={(HANDLE_SIZE / 2 + 1) * s}
              fill={colorValue(selectedLink.link.color)}
              stroke="var(--bg-base)"
              strokeWidth={1.5 * s}
              style={{ cursor: 'grab' }}
              onPointerDown={(event) => press(event, { kind: 'bend', linkId: selectedLink.link.id, start: local(event), moved: false })}
              onDoubleClick={() => onChange(updateLink(board, selectedLink.link.id, { bend: null }))}
            />
          )}
          {draft && draft.corners.length > 0 && (
            <g style={{ pointerEvents: 'none' }}>
              <polyline
                points={draft.corners.map(([x, y]) => `${x},${y}`).join(' ')}
                fill="none"
                stroke="var(--accent-strong)"
                strokeWidth={2 * s}
                strokeDasharray={`${6 * s} ${4 * s}`}
              />
              {draft.corners.map(([x, y], index) => (
                <circle
                  key={index}
                  cx={x}
                  cy={y}
                  r={(index === 0 ? HANDLE_SIZE : HANDLE_SIZE / 2) * s}
                  fill={index === 0 ? 'var(--accent-strong)' : 'var(--text-primary)'}
                />
              ))}
            </g>
          )}
        </g>
      </svg>

      <Group gap="xs" pos="absolute" top={8} left={8} right={8} justify="space-between" align="flex-start" style={{ pointerEvents: 'none' }}>
        <Group gap="xs" style={{ pointerEvents: 'auto' }}>
          {editable && !editMode && (
            <Button
              size="xs"
              variant="default"
              leftSection={<PencilSimpleIcon size={14} />}
              onClick={() => {
                setEditMode(true);
                setSelected(null);
              }}
            >
              {t('maps.geo.editMap')}
            </Button>
          )}
          {canEdit && (
            <>
              <SegmentedControl
                size="xs"
                value={tool}
                onChange={(value) => chooseTool(value as Tool)}
                aria-label={t('maps.geo.tool')}
                data={[
                  { value: 'select', label: t('maps.geo.tools.select') },
                  { value: 'area', label: t('maps.geo.tools.area') },
                  { value: 'pin', label: t('maps.geo.tools.pin') },
                  { value: 'link', label: t('maps.geo.tools.link') },
                ]}
              />
              <Button size="xs" variant="light" leftSection={<CheckIcon size={14} />} onClick={stopEditing}>
                {t('maps.geo.doneEditing')}
              </Button>
            </>
          )}
          {tags.length > 0 && (
            <Select
              size="xs"
              w={180}
              clearable
              clearButtonProps={{ 'aria-label': t('maps.geo.clearFilter') }}
              searchable
              placeholder={t('maps.geo.filter')}
              aria-label={t('maps.geo.filter')}
              value={tagId}
              onChange={setTagId}
              data={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
            />
          )}
        </Group>
        {showCard && selectedItem && (
          <Paper withBorder radius="md" p="sm" w={260} shadow="md" style={{ pointerEvents: 'auto' }}>
            <Stack gap={4}>
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Text fw={700} style={{ fontFamily: 'var(--font-display)' }}>
                  {placeName(selectedItem)}
                </Text>
                <CloseButton size="sm" aria-label={t('common.close')} onClick={() => setSelected(null)} />
              </Group>
              {'points' in selectedItem && placeSubtitle(selectedItem) && (
                <Text size="sm" c="dimmed">
                  {placeSubtitle(selectedItem)}
                </Text>
              )}
              {selectedItem.note && (
                <Text size="sm" style={{ whiteSpace: 'pre-line' }}>
                  {selectedItem.note}
                </Text>
              )}
              <Group gap="xs" mt={4}>
                {selectedItem.documentId && !onSelectDocument && (
                  <Button
                    size="xs"
                    variant="light"
                    component={Link}
                    to={`/rooms/${roomId}/documents/${selectedItem.documentId}`}
                    state={backState}
                  >
                    {t('maps.geo.openDocument')}
                  </Button>
                )}
                {canEdit && (
                  <Button
                    size="xs"
                    variant="default"
                    onClick={() =>
                      setEditing(
                        selected!.kind === 'area'
                          ? { kind: 'area', area: selectedItem as GeoArea, isNew: false }
                          : { kind: 'pin', pin: selectedItem as GeoPin, isNew: false },
                      )
                    }
                  >
                    {t('common.edit')}
                  </Button>
                )}
              </Group>
            </Stack>
          </Paper>
        )}
      </Group>

      {(tool === 'area' || tool === 'pin' || tool === 'link') && (
        <Paper
          withBorder
          radius="md"
          px="sm"
          py={6}
          pos="absolute"
          bottom={8}
          left="50%"
          style={{ transform: 'translateX(-50%)' }}
        >
          <Group gap="xs" wrap="nowrap">
            <Text size="xs" c="dimmed" role="status">
              {tool === 'area'
                ? t('maps.geo.areaHint')
                : tool === 'pin'
                  ? t('maps.geo.pinHint')
                  : linkStart
                    ? t('maps.geo.linkHintSecond', { name: placeName(findItem(board, linkStart)!) })
                    : t('maps.geo.linkHintFirst')}
            </Text>
            {tool === 'area' && draft && (
              <>
                <Button size="compact-xs" variant="default" onClick={() => setDraft(undoCorner(draft))}>
                  {t('maps.geo.undoCorner')}
                </Button>
                <Button
                  size="compact-xs"
                  disabled={!canClose(draft)}
                  onClick={() => {
                    setDraft(null);
                    setTool('select');
                    setEditing({ kind: 'area', area: newArea(draft.corners), isNew: true });
                  }}
                >
                  {t('maps.geo.finishArea')}
                </Button>
              </>
            )}
            <Button size="compact-xs" variant="subtle" color="gray" onClick={() => chooseTool('select')}>
              {t('common.cancel')}
            </Button>
          </Group>
        </Paper>
      )}

      <Stack gap={4} pos="absolute" bottom={8} right={8}>
        <Tooltip label={t('maps.geo.zoomIn')} position="left" withArrow>
          <ActionIcon
            variant="default"
            aria-label={t('maps.geo.zoomIn')}
            onClick={() => setMoved(zoomAt(view, ZOOM_STEP, { x: box.width / 2, y: box.height / 2 }))}
          >
            <PlusIcon size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t('maps.geo.zoomOut')} position="left" withArrow>
          <ActionIcon
            variant="default"
            aria-label={t('maps.geo.zoomOut')}
            onClick={() => setMoved(zoomAt(view, 1 / ZOOM_STEP, { x: box.width / 2, y: box.height / 2 }))}
          >
            <MinusIcon size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t('maps.geo.fit')} position="left" withArrow>
          <ActionIcon variant="default" aria-label={t('maps.geo.fit')} onClick={() => setMoved(null)}>
            <ArrowsInIcon size={16} />
          </ActionIcon>
        </Tooltip>
      </Stack>

      {editing?.kind === 'area' && (
        <AreaDialog
          key={editing.area.id}
          area={editing.area}
          isNew={editing.isNew}
          documents={documents}
          takenDocumentIds={taken}
          isMaster={isMaster}
          onClose={close}
          onSave={(area) => {
            onChange(putArea(board, area));
            setSelected({ kind: 'area', id: area.id });
            close();
          }}
          onDelete={() => {
            onChange(removeItem(board, { kind: 'area', id: editing.area.id }));
            setSelected(null);
            close();
          }}
        />
      )}
      {editing?.kind === 'pin' && (
        <PinDialog
          key={editing.pin.id}
          pin={editing.pin}
          isNew={editing.isNew}
          documents={documents}
          takenDocumentIds={taken}
          isMaster={isMaster}
          onClose={close}
          onSave={(pin) => {
            onChange(putPin(board, pin));
            close();
          }}
          onDelete={() => {
            onChange(removeItem(board, { kind: 'pin', id: editing.pin.id }));
            setSelected(null);
            close();
          }}
        />
      )}
      {editedLink && (
        <ArrowDialog
          key={editedLink.id}
          arrow={editedLink}
          fromName={nameOfEnd(editedLink.from)}
          toName={nameOfEnd(editedLink.to)}
          isMaster={isMaster}
          onClose={close}
          onSave={(patch) => {
            onChange(updateLink(board, editedLink.id, patch));
            close();
          }}
          onDelete={() => {
            onChange(removeLink(board, editedLink.id));
            setSelected(null);
            close();
          }}
        />
      )}
    </Box>
  );
}

function labelAt(from: Point, to: Point, curve: Curve, position: number, offset: number | null): Point {
  const base = pointOnCurve(curve, position);
  const side = pointBeside(from, to, position, offset ?? 0);
  const straight = pointBeside(from, to, position, 0);
  return { x: base.x + side.x - straight.x, y: base.y + side.y - straight.y };
}

/** A link's labels and where they are written. */
function linkLabels(link: GeoLink, from: Point, to: Point, curve: Curve) {
  const labels: { key: string; text: string; at: Point }[] = [];
  if (link.direction === 'both') {
    if (link.label) labels.push({ key: 'label', text: link.label, at: labelAt(from, to, curve, link.labelPosition ?? 0.75, link.labelOffset) });
    if (link.reverseLabel) {
      labels.push({
        key: 'reverse',
        text: link.reverseLabel,
        at: labelAt(from, to, curve, link.reverseLabelPosition ?? 0.25, link.reverseLabelOffset),
      });
    }
  } else if (link.label) {
    labels.push({ key: 'label', text: link.label, at: labelAt(from, to, curve, link.labelPosition ?? 0.5, link.labelOffset) });
  }
  return labels;
}

/**
 * Where each area's name goes on `board` when one plane unit is `s` screen
 * pixels (spec 38b): clear of the pins, their names and the links' labels,
 * which keep their screen size.
 */
function areaLabelPoints(board: GeoBoard, s: number): Map<string, Point> {
  const lineHeight = LABEL_FONT * 1.2 * s;
  const obstacles: LabelBox[] = [
    ...board.pins.flatMap((pin) => {
      const r = (PIN_RADIUS + 2) * s;
      const label = labelPlacement(pin.labelSide);
      const width = textWidth(placeName(pin), LABEL_FONT * s);
      const x = pin.x + label.dx * s;
      const y = pin.y + label.dy * s;
      return [
        { x: pin.x - r, y: pin.y - r, width: 2 * r, height: 2 * r },
        {
          x: label.anchor === 'start' ? x : label.anchor === 'end' ? x - width : x - width / 2,
          y: label.baseline === 'central' ? y - lineHeight / 2 : label.baseline === 'auto' ? y - lineHeight : y,
          width,
          height: lineHeight,
        },
      ];
    }),
    ...board.links.flatMap((link) => {
      const geometry = linkGeometry(board, link, (PIN_RADIUS + 3) * s);
      if (!geometry) return [];
      return linkLabels(link, geometry.from, geometry.to, geometry.curve).map((label) => {
        const width = textWidth(label.text, LABEL_FONT * s);
        return { x: label.at.x - width / 2, y: label.at.y - lineHeight / 2, width, height: lineHeight };
      });
    }),
  ];
  return placeAreaLabels(
    board.areas.map((area) => {
      const subtitle = placeSubtitle(area);
      const half = AREA_FONT * 0.65 * s;
      return {
        id: area.id,
        points: area.points,
        width: Math.max(textWidth(placeName(area), AREA_FONT * 1.05 * s), subtitle ? textWidth(subtitle, LABEL_FONT * s) : 0),
        above: half,
        below: subtitle ? AREA_FONT * 1.2 * s + LABEL_FONT * 0.65 * s : half,
      };
    }),
    obstacles,
  );
}

function roundPoint(point: Point): Point {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}
