import { useState } from 'react';
import { Box, Image, Paper, Stack, Text } from '@mantine/core';
import type { NodeProps } from '@xyflow/react';
import { DotsSixIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CARD_WIDTH, colorValue } from '../../lib/maps';
import type { DocumentCardNodeType } from '../../types/mapNodes';
import { useDocumentMentions } from '../../hooks/useDocumentMentions';
import { DocumentMentionPreview } from '../mentions/DocumentMentionPreview';
import { DocumentOpenMenu } from '../documents/DocumentOpenMenu';
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
      <DotsSixIcon size={16} weight="bold" />
    </Box>
  );
}

/**
 * A Document on a map (spec 28 Decision 8): its image (the one chosen for the
 * card, else the Document's favorite) as the card's background fading into
 * the card towards the bottom, where its name and caption (the map's own, or
 * else the Document's subtitle) are, in the card's color and struck through
 * when it is. Resting the pointer on it previews the Document's card; a
 * click on its name (anywhere on it, on a read-only board) offers to open
 * the Document beside the page or to go to it (spec 37).
 */
export function DocumentCardNode({ data, selected, dragging }: NodeProps<DocumentCardNodeType>) {
  const { t } = useTranslation();
  const { card, roomId, editable, connectable, onEdit } = data;
  // Only the Documents the viewer sees reach the board, each with its look.
  const document = card.document!;
  const caption = card.caption ?? document.subtitle;
  const decoration = card.struck ? 'line-through' : undefined;
  // The whole Document, for the preview: the page's list, filtered for the viewer.
  const mentions = useDocumentMentions();
  const full = mentions?.documents.find((candidate) => candidate.id === document.id);
  // The preview wraps the name's menu on an edited card, so it is told directly.
  const [menuOpen, setMenuOpen] = useState(false);

  const name = (
    <Text
      component={Link}
      to={`/rooms/${roomId}/documents/${document.id}`}
      fw={600}
      ta="center"
      c={colorValue(card.color)}
      td={decoration}
      className="nodrag"
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 18,
        lineHeight: 1.2,
      }}
    >
      {document.name}
    </Text>
  );

  let body = (
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
        {editable ? (
          <DocumentOpenMenu roomId={roomId} documentId={document.id} onOpenChange={setMenuOpen}>
            {name}
          </DocumentOpenMenu>
        ) : (
          name
        )}
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
            <PencilSimpleIcon size={14} />
          </LabeledActionIcon>
        </Box>
      )}
    </Paper>
  );
  if (full) {
    body = (
      <DocumentMentionPreview roomId={roomId} document={full} tags={mentions!.tags} disabled={dragging || menuOpen}>
        {body}
      </DocumentMentionPreview>
    );
  }
  return editable ? (
    body
  ) : (
    <DocumentOpenMenu roomId={roomId} documentId={document.id} component="div" onOpenChange={setMenuOpen}>
      {body}
    </DocumentOpenMenu>
  );
}
