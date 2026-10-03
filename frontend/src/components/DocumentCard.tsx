import { Badge, Box, Card, Group, Stack, Title, Text } from '@mantine/core';
import { Link } from 'react-router-dom';
import { VisibilityBadge } from './VisibilityBadge';
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

interface DocumentCardProps {
  document: Document;
  roomId: string;
  tags: Tag[];
  members: Member[];
}

/**
 * A Document in the Room's list: name, visibility, Tags and description, with
 * its images filling the card's right half, its player (for a Character) and
 * Owners, and what is new in its Thread since the viewer last opened it (spec
 * 19b): a count, or a "not yet read" dot for a Document never opened. The whole card links to the Document.
 */
export function DocumentCard({ document, roomId, tags, members }: DocumentCardProps) {
  const { t } = useTranslation();
  const ownerNames = document.ownerIds.map((id) => displayNameFor(members, id)).join(', ');
  const hasImages = document.images.length > 0;
  const player = document.playedBy ? findMember(members, document.playedBy) : undefined;

  const marks = (
    <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
      <UnreadMark count={document.unreadCount} />
      <VisibilityBadge visibility={document.visibility} />
    </Group>
  );

  return (
    <Card withBorder padding="md" radius="md" pos="relative" mih={hasImages ? CARD_WITH_IMAGES_MIN_HEIGHT : undefined}>
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
        style={hasImages ? { flex: 1 } : undefined}
      >
        {/* Title block: name and visibility on top, Tags on their own line. */}
        <Stack gap={4}>
          <Group justify="space-between" align="flex-start" wrap="nowrap" preventGrowOverflow={false}>
            <Title
              order={4}
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
 * The card's unread mark (spec 19b): the number of new Comments and replies,
 * a dot when the Document was never opened (null), nothing otherwise. Each
 * carries an accessible label, since the number or dot alone says little.
 */
function UnreadMark({ count }: { count: number | null | undefined }) {
  const { t } = useTranslation();
  if (count === null) {
    return (
      <Box
        role="img"
        aria-label={t('documents.notYetRead')}
        title={t('documents.notYetRead')}
        w={8}
        h={8}
        style={{ borderRadius: '50%', background: 'var(--accent-primary)' }}
      />
    );
  }
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
