import { useRef, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  useInternalNode,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react';
import { Text, UnstyledButton } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import {
  arrowCurve,
  colorValue,
  curvePath,
  fanBend,
  labelOnCurve,
  labelSize,
  offsetFromCurve,
  placeLabel,
  pointOnCurve,
  projectOnCurve,
  shiftCurve,
  type Point,
  type Rect,
} from '../../lib/maps';
import type { MapEdge } from '../../types/mapNodes';

function rectOf(node: ReturnType<typeof useInternalNode>): Rect | null {
  if (!node) return null;
  const { x, y } = node.internals.positionAbsolute;
  return { x, y, width: node.measured.width ?? 0, height: node.measured.height ?? 0 };
}

/** Which of an arrow's two labels: the one pointing at `to`, or the reverse one of a two-way arrow. */
type Which = 'label' | 'reverse';

/**
 * An arrow of a map (spec 28 Decision 5), drawn as a gentle curve from edge to
 * edge of the two cards or groups (spec 62), fanned out from the other
 * arrows joining the same two. A one-way arrow and a line carry their label in the
 * middle; a two-way arrow carries one label near each end, each naming how
 * the card it points at is seen from the other. Clicking it, or a label,
 * opens it for editing; dragging a label moves it freely, along the arrow
 * and to either side of it, and the place it is dropped at is kept.
 */
export function MapArrow({ id, source, target, markerEnd, markerStart, data }: EdgeProps<MapEdge>) {
  const { t } = useTranslation();
  const flow = useReactFlow();
  const [dragging, setDragging] = useState<{ which: Which; position: number; offset: number } | null>(
    null,
  );
  // The press that may become a drag; a press that never moves is a click.
  const press = useRef<{ which: Which; x: number; y: number; moved: { position: number; offset: number } | null } | null>(null);
  const justDragged = useRef(false);
  const sourceRect = rectOf(useInternalNode(source));
  const targetRect = rectOf(useInternalNode(target));
  if (!sourceRect || !targetRect || !data) return null;
  const { arrow, shift, fan, editable, onEdit, onMoveLabel } = data;
  const length = Math.hypot(
    targetRect.x + targetRect.width / 2 - (sourceRect.x + sourceRect.width / 2),
    targetRect.y + targetRect.height / 2 - (sourceRect.y + sourceRect.height / 2),
  );
  const curve = shiftCurve(arrowCurve(sourceRect, targetRect, fanBend(fan, length)), shift);
  const { from, to } = curve;
  const color = colorValue(arrow.color);

  // A dragged label sits where it was dropped; the others slide along the
  // arrow until no card covers them (nor another label).
  type Spot = { position: number; offset: number };
  const savedSpot = (position: number | null, offset: number | null): Spot | null =>
    position === null ? null : { position, offset: offset ?? 0 };
  const wanted: { which: Which; text: string; preferred: number; saved: Spot | null }[] = [];
  if (arrow.direction === 'both') {
    if (arrow.label) {
      wanted.push({
        which: 'label',
        text: arrow.label,
        preferred: 0.75,
        saved: savedSpot(arrow.labelPosition, arrow.labelOffset),
      });
    }
    if (arrow.reverseLabel) {
      wanted.push({
        which: 'reverse',
        text: arrow.reverseLabel,
        preferred: 0.25,
        saved: savedSpot(arrow.reverseLabelPosition, arrow.reverseLabelOffset),
      });
    }
  } else if (arrow.label) {
    wanted.push({
      which: 'label',
      text: arrow.label,
      preferred: 0.5,
      saved: savedSpot(arrow.labelPosition, arrow.labelOffset),
    });
  }
  const avoid: Rect[] = [sourceRect, targetRect];
  // The area the two cards span, stretched to the curve's middle.
  const middle = pointOnCurve(curve, 0.5);
  const left = Math.min(sourceRect.x, targetRect.x, middle.x);
  const top = Math.min(sourceRect.y, targetRect.y, middle.y);
  const within: Rect = {
    x: left,
    y: top,
    width: Math.max(sourceRect.x + sourceRect.width, targetRect.x + targetRect.width, middle.x) - left,
    height: Math.max(sourceRect.y + sourceRect.height, targetRect.y + targetRect.height, middle.y) - top,
  };
  const spotOf = (which: Which, saved: Spot | null): Spot | null =>
    dragging?.which === which ? dragging : saved;
  const placed = new Map<Which, Point>();
  const reserve = (text: string, at: Point) => {
    const size = labelSize(text);
    avoid.push({ x: at.x - size.width / 2, y: at.y - size.height / 2, ...size });
  };
  for (const { which, text, saved } of wanted) {
    const spot = spotOf(which, saved);
    if (spot === null) continue;
    const at = labelOnCurve(from, to, curve, spot.position, spot.offset);
    placed.set(which, at);
    reserve(text, at);
  }
  for (const { which, text, preferred, saved } of wanted) {
    if (spotOf(which, saved) !== null) continue;
    const at = placeLabel(from, to, preferred, labelSize(text), avoid, within, curve.control);
    placed.set(which, at);
    reserve(text, at);
  }
  const labels = wanted.map(({ which, text }) => ({ which, text, at: placed.get(which)! }));

  const move = (event: React.PointerEvent, which: Which) => {
    const start = press.current;
    if (!start || start.which !== which) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4 && start.moved === null) return;
    const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const position = Math.round(projectOnCurve(curve, at) * 1000) / 1000;
    const spot = { position, offset: Math.round(offsetFromCurve(curve, position, at)) };
    start.moved = spot;
    // From the first real move on, the click that ends the press is not a request to edit.
    justDragged.current = true;
    setDragging({ which, ...spot });
  };

  const drop = () => {
    const start = press.current;
    press.current = null;
    setDragging(null);
    if (start?.moved) onMoveLabel(arrow.id, start.which, start.moved.position, start.moved.offset);
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={curvePath(curve)}
        markerEnd={markerEnd}
        markerStart={markerStart}
        interactionWidth={16}
        style={{
          stroke: color,
          strokeWidth: 2,
          strokeDasharray: arrow.masterOnly ? '6 4' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        {labels.map((label) => (
          <UnstyledButton
            key={label.which}
            className="nodrag nopan"
            disabled={!editable}
            onPointerDown={(event: React.PointerEvent<HTMLButtonElement>) => {
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture?.(event.pointerId);
              justDragged.current = false;
              press.current = { which: label.which, x: event.clientX, y: event.clientY, moved: null };
            }}
            onPointerMove={(event: React.PointerEvent) => move(event, label.which)}
            onPointerUp={drop}
            onPointerCancel={() => {
              press.current = null;
              justDragged.current = false;
              setDragging(null);
            }}
            onClick={(event) => {
              // The label lives in a portal, but React still bubbles its click to the
              // edge's own handler, which opens the relation: the label decides alone.
              event.stopPropagation();
              // The click that ends a drag is not a request to edit.
              if (justDragged.current) {
                justDragged.current = false;
                return;
              }
              onEdit(arrow.id);
            }}
            aria-label={editable ? t('maps.editArrow', { label: label.text }) : undefined}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${label.at.x}px, ${label.at.y}px)`,
              pointerEvents: 'all',
              background: 'var(--bg-base)',
              border: `1px solid ${color}`,
              borderRadius: 'var(--mantine-radius-sm)',
              padding: '1px 6px',
              cursor: editable ? 'grab' : 'default',
              touchAction: 'none',
            }}
          >
            <Text size="xs" c={color} fw={500}>
              {label.text}
            </Text>
          </UnstyledButton>
        ))}
      </EdgeLabelRenderer>
    </>
  );
}
