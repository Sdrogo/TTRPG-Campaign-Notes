import { BaseEdge, EdgeLabelRenderer, useInternalNode, type EdgeProps } from '@xyflow/react';
import { Text, UnstyledButton } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { arrowEnds, colorValue, labelSize, placeLabel, type Point, type Rect } from '../../lib/maps';
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
 * opens it for editing.
 */
export function MapArrow({ id, source, target, markerEnd, markerStart, data }: EdgeProps<MapEdge>) {
  const { t } = useTranslation();
  const sourceRect = rectOf(useInternalNode(source));
  const targetRect = rectOf(useInternalNode(target));
  if (!sourceRect || !targetRect || !data) return null;
  const { arrow, editable, onEdit } = data;
  const { from, to } = arrowEnds(sourceRect, targetRect);
  const color = colorValue(arrow.color);

  // Each label slides along the arrow until no card covers it (nor the other label).
  const wanted: { text: string; t: number }[] = [];
  if (arrow.direction === 'both') {
    if (arrow.label) wanted.push({ text: arrow.label, t: 0.75 });
    if (arrow.reverseLabel) wanted.push({ text: arrow.reverseLabel, t: 0.25 });
  } else if (arrow.label) {
    wanted.push({ text: arrow.label, t: 0.5 });
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
  const labels: { text: string; at: Point }[] = wanted.map(({ text, t }) => {
    const size = labelSize(text);
    const at = placeLabel(from, to, t, size, avoid, within);
    avoid.push({ x: at.x - size.width / 2, y: at.y - size.height / 2, ...size });
    return { text, at };
  });

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
            key={label.text + label.at.x}
            className="nodrag nopan"
            disabled={!editable}
            onClick={() => onEdit(arrow.id)}
            aria-label={editable ? t('maps.editArrow', { label: label.text }) : undefined}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${label.at.x}px, ${label.at.y}px)`,
              pointerEvents: 'all',
              background: 'var(--bg-base)',
              border: `1px solid ${color}`,
              borderRadius: 'var(--mantine-radius-sm)',
              padding: '1px 6px',
              cursor: editable ? 'pointer' : 'default',
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
