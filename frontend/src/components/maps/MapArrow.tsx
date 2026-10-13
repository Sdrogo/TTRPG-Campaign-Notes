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
  arrowEnds,
  colorValue,
  labelSize,
  placeLabel,
  pointAlong,
  projectOnLine,
  type Point,
  type Rect,
} from '../../lib/maps';
import type { MapEdge } from '../../types/mapNodes';

function rectOf(node: ReturnType<typeof useInternalNode>): Rect | null {
  if (!node) return null;
  const { x, y } = node.internals.positionAbsolute;
  return { x, y, width: node.measured.width ?? 0, height: node.measured.height ?? 0 };
}

/**
 * An arrow of a map (spec 28 Decision 5), drawn straight from edge to edge of
 * the two cards or groups. A one-way arrow and a line carry their label in the
 * middle; a two-way arrow carries one label near each end, each naming how
 * the card it points at is seen from the other. Clicking it, or a label,
 * opens it for editing; dragging a label slides it along the arrow, and the
 * place it is dropped at is kept.
 */
type Which = 'label' | 'reverse';

export function MapArrow({ id, source, target, markerEnd, markerStart, data }: EdgeProps<MapEdge>) {
  const { t } = useTranslation();
  const flow = useReactFlow();
  const [dragging, setDragging] = useState<{ which: Which; position: number } | null>(null);
  // The press that may become a drag; a press that never moves is a click.
  const press = useRef<{ which: Which; x: number; y: number; position: number | null } | null>(null);
  const justDragged = useRef(false);
  const sourceRect = rectOf(useInternalNode(source));
  const targetRect = rectOf(useInternalNode(target));
  if (!sourceRect || !targetRect || !data) return null;
  const { arrow, editable, onEdit, onMoveLabel } = data;
  const { from, to } = arrowEnds(sourceRect, targetRect);
  const color = colorValue(arrow.color);

  // A dragged label sits where it was dropped; the others slide along the
  // arrow until no card covers them (nor another label).
  const wanted: { which: Which; text: string; preferred: number; saved: number | null }[] = [];
  if (arrow.direction === 'both') {
    if (arrow.label) wanted.push({ which: 'label', text: arrow.label, preferred: 0.75, saved: arrow.labelPosition });
    if (arrow.reverseLabel) {
      wanted.push({
        which: 'reverse',
        text: arrow.reverseLabel,
        preferred: 0.25,
        saved: arrow.reverseLabelPosition,
      });
    }
  } else if (arrow.label) {
    wanted.push({ which: 'label', text: arrow.label, preferred: 0.5, saved: arrow.labelPosition });
  }
  const avoid: Rect[] = [sourceRect, targetRect];
  const left = Math.min(sourceRect.x, targetRect.x);
  const top = Math.min(sourceRect.y, targetRect.y);
  const within: Rect = {
    x: left,
    y: top,
    width: Math.max(sourceRect.x + sourceRect.width, targetRect.x + targetRect.width) - left,
    height: Math.max(sourceRect.y + sourceRect.height, targetRect.y + targetRect.height) - top,
  };
  const positionOf = (which: Which, saved: number | null) =>
    dragging?.which === which ? dragging.position : saved;
  const placed = new Map<Which, Point>();
  const reserve = (text: string, at: Point) => {
    const size = labelSize(text);
    avoid.push({ x: at.x - size.width / 2, y: at.y - size.height / 2, ...size });
  };
  for (const { which, text, saved } of wanted) {
    const position = positionOf(which, saved);
    if (position === null) continue;
    const at = pointAlong(from, to, position);
    placed.set(which, at);
    reserve(text, at);
  }
  for (const { which, text, preferred, saved } of wanted) {
    if (positionOf(which, saved) !== null) continue;
    const at = placeLabel(from, to, preferred, labelSize(text), avoid, within);
    placed.set(which, at);
    reserve(text, at);
  }
  const labels = wanted.map(({ which, text, saved }) => ({
    which,
    text,
    saved,
    at: placed.get(which)!,
  }));

  const move = (event: React.PointerEvent, which: Which) => {
    const start = press.current;
    if (!start || start.which !== which) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4 && start.position === null) return;
    const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const position = Math.round(projectOnLine(from, to, at) * 1000) / 1000;
    start.position = position;
    setDragging({ which, position });
  };

  const drop = () => {
    const start = press.current;
    press.current = null;
    setDragging(null);
    if (start?.position != null) {
      justDragged.current = true;
      setTimeout(() => {
        justDragged.current = false;
      }, 0);
      onMoveLabel(arrow.id, start.which, start.position);
    }
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={`M ${from.x},${from.y} L ${to.x},${to.y}`}
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
              press.current = { which: label.which, x: event.clientX, y: event.clientY, position: null };
            }}
            onPointerMove={(event: React.PointerEvent) => move(event, label.which)}
            onPointerUp={drop}
            onPointerCancel={() => {
              press.current = null;
              setDragging(null);
            }}
            onClick={() => {
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
