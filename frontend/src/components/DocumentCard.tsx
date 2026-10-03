import { Badge, Box, Card, Group, Stack, Title, Text } from '@mantine/core';
import { Link } from 'react-router-dom';
import { VisibilityBadge } from './VisibilityBadge';
import { RevealedBadge } from './RevealedBadge';
import { TagList } from './TagList';
import { DocumentCardImages } from './DocumentCardImages';
import { MentionText } from './mentions/MentionText';
import { UserAvatar } from './UserAvatar';
import { displayNameFor, findMember, memberDisplayName } from '../lib/members';
import type { Document } from '../types/document';
import type { Member } from '../types/member';
import type { Tag } from '../types/tag';
import { useTranslation } from 'react-i18next';

// Tall enough that the image panel on the right reads as a picture, not a strip.
const CARD_WITH_IMAGES_MIN_HEIGHT = { base: 220, sm: 260 };

// Width / height of the image panel at its shortest: square, so a wide card
// grows taller instead of cropping its image to a strip.
const CARD_IMAGE_MIN_ASPECT_RATIO = '1';

interface DocumentCardProps {
  document: Document;
  roomId: string;
  tags: Tag[];
  members: Member[];
  /** The name's heading level: 2 right under the page's title, 3 under a
   *  group heading, so the outline never skips a level. Looks the same. */
  headingOrder?: 2 | 3;
  /**
   * The Master revealed it, or something on it, to the viewer, who hasn't
   * opened it since (spec 22 Decision 3).
   */
  revealed?: boolean;
}

/**
 * A Document in the Room's list: name, visibility, Tags and description, with
 * its images filling the card's right half, its player (for a Character) and
 * Owners, and what is new in its Thread since the viewer last opened it (spec
 * 19b): a count, or a "not yet read" dot for a Document never opened, and a
 * "Revealed" mark (spec 22). The whole card links to the Document.
 */
export function DocumentCard({
  document,
  roomId,
  tags,
  members,
  headingOrder = 2,
  revealed = false,
}: DocumentCardProps) {
  const { t } = useTranslation();
  const ownerNames = document.ownerIds.map((id) => displayNameFor(members, id)).join(', ');
  const hasImages = document.images.length > 0;
  const player = document.playedBy ? findMember(members, document.playedBy) : undefined;

  const marks = (
    <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
      {revealed && <RevealedBadge />}
      <UnreadCount count={document.unreadCount} />
      {/* A Document never opened shows a dot inside its visibility badge. */}
      <VisibilityBadge
        visibility={document.visibility}
        leftSection={document.unreadCount === null ? <NotYetReadDot /> : undefined}
      />
    </Group>
  );

  return (
    <Card
      withBorder
      padding="md"
      radius="md"
      pos="relative"
      mih={hasImages ? CARD_WITH_IMAGES_MIN_HEIGHT : undefined}
      // With images, the text column and the image's floor (below) sit side by side.
      style={hasImages ? { flexDirection: 'row' } : undefined}
    >
      {/* With images, they fill the card's right half edge to edge, fading
          into the card on their left, and the badges sit on top of them. */}
      {hasImages && (
        <Box pos="absolute" top={0} right={0} bottom={0} w="50%">
          <DocumentCardImages images={document.images} documentName={document.name} />
        </Box>
      )}
      {hasImages && (
        <Box pos="absolute" top="var(--mantine-spacing-md)" right="var(--mantine-spacing-md)">
          {marks}
        </Box>
      )}

      <Stack
        gap="xs"
        // Above the images, which are positioned and would otherwise paint over it.
        pos="relative"
        w={hasImages ? 'calc(50% - var(--mantine-spacing-sm))' : undefined}
        style={hasImages ? { flexShrink: 0 } : undefined}
      >
        {/* Title block: name and visibility on top, Tags on their own line. */}
        <Stack gap={4}>
          <Group justify="space-between" align="flex-start" wrap="nowrap" preventGrowOverflow={false}>
            <Title
              order={headingOrder}
              fz="h4"
              style={{ fontFamily: 'var(--font-display)', minWidth: 0, overflowWrap: 'anywhere' }}
            >
              {document.name}
            </Title>
            {!hasImages && marks}
          </Group>
          <TagList tags={tags} tagIds={document.tagIds} roomId={roomId} />
        </Stack>

        {/* The description takes the left column, growing so the Played by
            and Owner lines close the card at the bottom. */}
        <Box style={hasImages ? { flex: 1 } : undefined}>
          {document.description ? (
            // The card is itself a link, so mentions are only colored here.
            <MentionText
              text={document.description}
              linked={false}
              c="dimmed"
              size="sm"
              lineClamp={hasImages ? 5 : 2}
            />
          ) : (
            <Text size="sm" c="dimmed" fs="italic">
              {t('common.noDescription')}
            </Text>
          )}
        </Box>

        {/* D-23: a Character shows who plays it. */}
        {document.playedBy && (
          <Group gap={6} wrap="nowrap">
            <UserAvatar user={player} size={20} />
            <Text size="xs" c="dimmed" truncate>
              {t('characters.playedByLine', { name: memberDisplayName(player) })}
            </Text>
          </Group>
        )}

        {ownerNames && (
          <Text size="xs" c="dimmed" truncate>
            {t('documents.ownersLine', { names: ownerNames })}
          </Text>
        )}
      </Stack>

      {/* The image panel's floor: an empty square under it, so the card is at
          least as tall as the panel is wide. On a wide card a fixed minimum
          height would leave a short, wide strip that crops a portrait to a
          sliver; this keeps the panel square or taller at any width. */}
      {hasImages && (
        <Box
          data-testid="card-image-floor"
          aria-hidden
          w="50%"
          ml="auto"
          style={{ aspectRatio: CARD_IMAGE_MIN_ASPECT_RATIO, alignSelf: 'flex-start', flexShrink: 0 }}
        />
      )}

      {/* The link covers the card rather than wrapping it: an <a> may not
          contain the carousel's buttons, which sit above this (see
          DocumentCardImages). Last child, so it overlays the content. */}
      <Link
        to={`/rooms/${roomId}/documents/${document.id}`}
        aria-label={document.name}
        style={{ position: 'absolute', inset: 0, zIndex: 1 }}
      />
    </Card>
  );
}

/**
 * The card's "not yet read" mark (spec 19b), shown inside the visibility badge
 * when the Document was never opened. It carries an accessible label, since
 * the dot alone says little.
 */
function NotYetReadDot() {
  const { t } = useTranslation();
  return (
    <Box
      role="img"
      aria-label={t('documents.notYetRead')}
      title={t('documents.notYetRead')}
      w={6}
      h={6}
      style={{ borderRadius: '50%', background: 'var(--accent-primary)' }}
    />
  );
}

/** The count of new Comments and replies, as a red pill beside the visibility
 *  badge (spec 19b), labeled for screen readers. Nothing when none are new. */
function UnreadCount({ count }: { count: number | null | undefined }) {
  const { t } = useTranslation();
  if (!count) {
    return null;
  }
  return (
    <Badge
      size="sm"
      variant="filled"
      color="accent"
      aria-label={t('documents.unreadCount', { count })}
      title={t('documents.unreadCount', { count })}
    >
      {count}
    </Badge>
  );
}
