import { ActionIcon, Box, Group, Paper, Text, Tooltip } from '@mantine/core';
import type { NodeProps } from '@xyflow/react';
import { EyeSlashIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { CARD_WIDTH, colorValue } from '../../lib/maps';
import type { CardSize } from '../../types/map';
import type { TextCardNodeType } from '../../types/mapNodes';
import { MapHandle } from './MapHandle';

const FONT_SIZES: Record<CardSize, number> = { normal: 14, large: 20, title: 30 };

/**
 * A text card (spec 28 Decision 6): free text over several lines in one of
 * three sizes, a title in the display font. A Master-only one carries a mark,
 * since only the Master ever sees it.
 */
export function TextCardNode({ data, selected }: NodeProps<TextCardNodeType>) {
  const { t } = useTranslation();
  const { card, editable, onEdit } = data;
  const isTitle = card.size === 'title';

  return (
    <Paper
      withBorder={!isTitle || selected}
      p={isTitle ? 4 : 8}
      pr={editable ? 28 : undefined}
      miw={isTitle ? undefined : CARD_WIDTH}
      maw={isTitle ? 480 : CARD_WIDTH * 1.5}
      bg={isTitle ? 'transparent' : 'var(--bg-surface)'}
      style={{
        borderColor: selected ? 'var(--accent-primary)' : 'var(--border-default)',
        opacity: card.struck ? 0.6 : 1,
      }}
    >
      <MapHandle visible={editable} />
      <Group gap={4} wrap="nowrap" align="flex-start">
        {card.masterOnly && (
          <Tooltip label={t('maps.masterOnly')} withArrow>
            <EyeSlashIcon size={14} aria-label={t('maps.masterOnly')} style={{ flexShrink: 0 }} />
          </Tooltip>
        )}
        <Text
          c={colorValue(card.color)}
          td={card.struck ? 'line-through' : undefined}
          fw={isTitle ? 600 : undefined}
          style={{
            whiteSpace: 'pre-line',
            fontSize: FONT_SIZES[card.size],
            lineHeight: 1.25,
            fontFamily: card.size === 'normal' ? undefined : 'var(--font-display)',
          }}
        >
          {card.text}
        </Text>
      </Group>
      {editable && (
        <Box pos="absolute" top={2} right={2}>
          <ActionIcon
            size="sm"
            variant="subtle"
            color="gray"
            className="nodrag"
            aria-label={t('maps.editText')}
            onClick={() => onEdit(card.id)}
          >
            <PencilSimpleIcon size={14} />
          </ActionIcon>
        </Box>
      )}
    </Paper>
  );
}
