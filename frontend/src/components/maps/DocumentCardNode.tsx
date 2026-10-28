import type { MouseEvent } from 'react';
import { Box, Image, Paper, Stack, Text } from '@mantine/core';
import { type NodeProps } from '@xyflow/react';
import { DotsSixIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useBackState } from '../../lib/backNav';
import { CARD_WIDTH, colorValue } from '../../lib/maps';
import type { DocumentCardNodeType } from '../../types/mapNodes';
import { MapHandle } from './MapHandle';
import { LabeledActionIcon } from '../LabeledActionIcon';

/** How tall a card with an image is: the image is its background, portrait framed. */
const IMAGE_CARD_HEIGHT = CARD_WIDTH * 1.5;

// The image melts into the card's surface towards the name, like a Document
// card's image does into its own.
const FADE_INTO_CARD = 'linear-gradient(to bottom, transparent 30%, var(--bg-raised) 92%)';

/** A mark that the card can be picked up and moved anywhere by its body. */
function DragGrip() {
  return (
    <Box
      pos="absolute"
      top={2}
      left={2}
      aria-hidden
      style={{
        pointerEvents: 'none',
        background: 'rgba(0, 0, 0, 0.55)',
        borderRadius: 'var(--mantine-radius-sm)',
        padding: 2,
        lineHeight: 0,
        color: 'var(--text-primary)',
      }}
    >
      <DotsSixIcon size={18} weight="bold" />
    </Box>
  );
}

/**
 * A Document on a map (spec 28 Decision 8): its image (the one chosen for the
 * card, else the Document's favorite) as the card's background fading into
 * the card towards the bottom, where its name and caption (the map's own, or
 * else the Document's subtitle) are, in the card's color and struck through
 * when it is. A click on its name goes to the Document, unless the split pane
 * follows the selected card (spec 37), where it selects the card instead.
 */
export function DocumentCardNode({ data, selected }: NodeProps<DocumentCardNodeType>) {
  const { t } = useTranslation();
  const { card, roomId, editable, connectable, onEdit, onSelect } = data;
  // Only the Documents the viewer sees reach the board, each with its look.
  const document = card.document!;
  const caption = card.caption ?? document.subtitle;
  const decoration = card.struck ? 'line-through' : undefined;
  const backState = useBackState();
  const name = (
    <Text
      component={Link}
      to={`/rooms/${roomId}/documents/${document.id}`}
      state={backState}
      fw={600}
      ta="center"
      c={colorValue(card.color)}
      td={decoration}
      className="nodrag"
      onClick={(event: MouseEvent) => {
        // A plain click picks the card for the split pane; Ctrl/Cmd still opens a tab.
        if (onSelect && !event.ctrlKey && !event.metaKey && !event.shiftKey) event.preventDefault();
      }}
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 18,
        lineHeight: 1.2,
      }}
    >
      {document.name}
    </Text>
  );

  return (
    <Paper
      className="map-card"
      withBorder
      w={CARD_WIDTH}
      bg="var(--bg-raised)"
      style={{
        borderColor: selected ? 'var(--accent-primary)' : 'var(--border-default)',
        opacity: card.struck ? 0.6 : 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        minHeight: document.image ? IMAGE_CARD_HEIGHT : undefined,
        position: 'relative',
      }}
    >
      <MapHandle visible={editable && connectable !== false} />
      {document.image && (
        // The image is clipped on its own layer: clipping the whole card would
        // cut the arrow handle on the card's edge in half.
        <Box pos="absolute" inset={0} style={{ overflow: 'hidden', borderRadius: 'inherit' }}>
          <Image
            src={document.image.url}
            alt=""
            pos="absolute"
            inset={0}
            h="100%"
            w="100%"
            fit="cover"
            style={{ objectPosition: 'center top' }}
          />
          <Box data-testid="map-card-fade" pos="absolute" inset={0} style={{ background: FADE_INTO_CARD }} />
        </Box>
      )}
      <Stack gap={4} p={8} pos="relative">
        {name}
        {caption && (
          <Text size="xs" c="dimmed" ta="center" td={decoration} style={{ whiteSpace: 'pre-line' }}>
            {caption}
          </Text>
        )}
      </Stack>
      {editable && <DragGrip />}
      {editable && (
        <Box pos="absolute" top={2} right={2}>
          <LabeledActionIcon
            size="sm"
            variant="filled"
            color="dark"
            className="nodrag"
            aria-label={t('maps.editCard', { name: document.name })}
            onClick={() => onEdit(card.id)}
          >
            <PencilSimpleIcon size={16} />
          </LabeledActionIcon>
        </Box>
      )}
    </Paper>
  );
}
