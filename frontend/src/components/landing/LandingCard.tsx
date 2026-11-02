import type { ReactNode } from 'react';
import { Badge, Box, Card, Group, Stack, Title } from '@mantine/core';
import { Link } from 'react-router-dom';
import { DocumentCardImages } from '../DocumentCardImages';
import { markdownToPlain } from '../../lib/markdownText';
import { MentionText } from '../mentions/MentionText';

interface LandingCardProps {
  to: string;
  /** Navigation state for the link (the back trail, `useBackState`). */
  state?: unknown;
  title: string;
  description?: string | null;
  imageUrl?: string | null;
  /** A small badge beside the title ("In corso"). */
  badge?: string | null;
  /** The title's heading level: 2 on the landing, 3 inside a block. */
  headingOrder?: 2 | 3 | 4;
  /** Edit-mode handles (drag, menu), above the card's link. */
  controls?: ReactNode;
}

// The image keeps the right half as a Document card's does (`DocumentCard`).
const CARD_WITH_IMAGE_MIN_HEIGHT = { base: 180, sm: 200 };

/**
 * One card of the landing (spec 55 Decision 7): a Section, a Document, a
 * map, a session, a step or a poll. An optional image on the right half
 * fading into the card, the title in the display font, the description as
 * plain text on three lines, and the lift on hover of `.document-card`. The
 * whole card is one link; no preview, no open menu. Mentions in the
 * description show their target's name, accent-coloured but not links (the
 * card's link lies over them), as on a Document card (spec 57c).
 */
export function LandingCard({ to, state, title, description, imageUrl, badge, headingOrder = 3, controls }: LandingCardProps) {
  const hasImage = Boolean(imageUrl);
  const text = description ? markdownToPlain(description, { separator: ' ' }) : '';
  return (
    <Card
      className="document-card room-landing-card"
      data-has-images={hasImage || undefined}
      withBorder
      padding="md"
      radius="md"
      pos="relative"
      mih={hasImage ? CARD_WITH_IMAGE_MIN_HEIGHT : undefined}
    >
      {hasImage && (
        <Box pos="absolute" top={0} right={0} bottom={0} w="50%">
          <DocumentCardImages images={[{ id: 'image', url: imageUrl!, isFavorite: true }]} documentName={title} />
        </Box>
      )}
      <Stack gap={6} pos="relative" w={hasImage ? 'calc(50% - var(--mantine-spacing-sm))' : undefined}>
        <Group gap="xs" wrap="nowrap" align="flex-start" preventGrowOverflow={false}>
          <Title order={headingOrder} fz="h4" style={{ fontFamily: 'var(--font-display)', overflowWrap: 'anywhere' }}>
            {title}
          </Title>
          {badge && (
            <Badge size="sm" variant="light" color="accent" style={{ flexShrink: 0 }}>
              {badge}
            </Badge>
          )}
        </Group>
        {text && (
          <MentionText text={text} linked={false} size="sm" c="dimmed" lineClamp={3} />
        )}
      </Stack>
      <Link to={to} state={state} aria-label={title} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
      {controls && (
        <Box pos="absolute" top={6} right={6} style={{ zIndex: 3 }}>
          {controls}
        </Box>
      )}
    </Card>
  );
}
