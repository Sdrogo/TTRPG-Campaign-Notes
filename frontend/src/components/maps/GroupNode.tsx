import { ActionIcon, Box, Group, Text } from '@mantine/core';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { PencilSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MIN_GROUP_SIZE, colorValue } from '../../lib/maps';
import type { GroupNodeType } from '../../types/mapNodes';
import { MapHandle } from './MapHandle';

/**
 * A group (spec 28 Decision 7): a framed box, with an optional title, that
 * holds cards. Dragging it moves its cards; an arrow can point at it as a
 * whole. Resizable while editing.
 */
export function GroupNode({ id, data, selected }: NodeProps<GroupNodeType>) {
  const { t } = useTranslation();
  const { group, editable, onEdit, onResized } = data;
  const color = colorValue(group.color);

  return (
    <Box
      w="100%"
      h="100%"
      style={{
        border: `2px dashed ${group.color === 'default' ? 'var(--border-default)' : color}`,
        borderRadius: 'var(--mantine-radius-lg)',
        background: 'color-mix(in srgb, var(--bg-surface) 55%, transparent)',
        outline: selected ? '1px solid var(--accent-primary)' : undefined,
      }}
    >
      {editable && (
        <NodeResizer
          minWidth={MIN_GROUP_SIZE}
          minHeight={MIN_GROUP_SIZE}
          isVisible={selected}
          color="var(--accent-primary)"
          onResizeEnd={(_, frame) => onResized(id, frame)}
        />
      )}
      <MapHandle visible={editable} />
      <Group justify="space-between" wrap="nowrap" px="xs" pt={4} gap={4}>
        <Text
          fw={600}
          c={color}
          td={group.struck ? 'line-through' : undefined}
          style={{ fontFamily: 'var(--font-display)', fontSize: 18 }}
          truncate
        >
          {group.title ?? ''}
        </Text>
        {editable && (
          <ActionIcon
            size="sm"
            variant="subtle"
            color="gray"
            className="nodrag"
            aria-label={t('maps.editGroup')}
            onClick={() => onEdit(group.id)}
          >
            <PencilSimpleIcon size={14} />
          </ActionIcon>
        )}
      </Group>
    </Box>
  );
}
