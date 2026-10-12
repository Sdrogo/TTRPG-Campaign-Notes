import { ActionIcon, Box, Image, Paper, Stack, Text } from '@mantine/core';
import type { NodeProps } from '@xyflow/react';
import { PencilSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CARD_WIDTH, colorValue } from '../../lib/maps';
import type { DocumentCardNodeType } from '../../types/mapNodes';
import { MapHandle } from './MapHandle';

/**
 * A Document on a map (spec 28 Decision 8): its first visible image in
 * portrait framing, its name and its caption (the map's own, or else the
 * Document's subtitle), in the card's color and struck through when it is.
 * Clicking the name opens the Document.
 */
export function DocumentCardNode({ data, selected }: NodeProps<DocumentCardNodeType>) {
  const { t } = useTranslation();
  const { card, roomId, editable, onEdit } = data;
  // Only the Documents the viewer sees reach the board, each with its look.
  const document = card.document!;
  const caption = card.caption ?? document.subtitle;
  const decoration = card.struck ? 'line-through' : undefined;

  return (
    <Paper
      withBorder
      p={6}
      w={CARD_WIDTH}
      bg="var(--bg-raised)"
      style={{
        borderColor: selected ? 'var(--accent-primary)' : 'var(--border-default)',
        opacity: card.struck ? 0.6 : 1,
      }}
    >
      <MapHandle visible={editable} />
      <Stack gap={4}>
        {document.image && (
          <Image
            src={document.image.url}
            alt=""
            h={CARD_WIDTH * 1.2}
            radius="sm"
            fit="cover"
            style={{ objectPosition: 'top' }}
          />
        )}
        <Text
          component={Link}
          to={`/rooms/${roomId}/documents/${document.id}`}
          fw={600}
          ta="center"
          c={colorValue(card.color)}
          td={decoration}
          className="nodrag"
          style={{ fontFamily: 'var(--font-display)', fontSize: 18, lineHeight: 1.2 }}
        >
          {document.name}
        </Text>
        {caption && (
          <Text size="xs" c="dimmed" ta="center" td={decoration} style={{ whiteSpace: 'pre-line' }}>
            {caption}
          </Text>
        )}
      </Stack>
      {editable && (
        <Box pos="absolute" top={2} right={2}>
          <ActionIcon
            size="sm"
            variant="subtle"
            color="gray"
            className="nodrag"
            aria-label={t('maps.editCard', { name: document.name })}
            onClick={() => onEdit(card.id)}
          >
            <PencilSimpleIcon size={14} />
          </ActionIcon>
        </Box>
      )}
    </Paper>
  );
}
