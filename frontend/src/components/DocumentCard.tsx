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

interface DocumentCardProps {
  document: Document;
  roomId: string;
  tags: Tag[];
  members: Member[];
}

/**
 * A Document in the Room's list: name, visibility, Tags, description and
 * images, with its player (for a Character) and Owners, and what is new in its
 * Thread since the viewer last opened it (spec 19b): a count, or a "not yet
 * read" dot for a Document never opened. The whole card links to the Document.
 */
export function DocumentCard({ document, roomId, tags, members }: DocumentCardProps) {
  const { t } = useTranslation();
  const ownerNames = document.ownerIds.map((id) => displayNameFor(members, id)).join(', ');
  const hasImages = document.images.length > 0;
  const player = document.playedBy ? findMember(members, document.playedBy) : undefined;

  return (
    <Card withBorder padding="md" radius="md" pos="relative">
      <Stack gap="xs">
        {/* Title block: name and visibility on top, Tags on their own line. */}
        <Stack gap={4}>
          <Group justify="space-between" align="flex-start" wrap="nowrap" preventGrowOverflow={false}>
            <Title
              order={4}
              style={{ fontFamily: 'var(--font-display)', minWidth: 0, overflowWrap: 'anywhere' }}
            >
              {document.name}
            </Title>
            <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
              <UnreadMark count={document.unreadCount} />
              <VisibilityBadge visibility={document.visibility} />
            </Group>
          </Group>
          <TagList tags={tags} tagIds={document.tagIds} roomId={roomId} />
        </Stack>

        {/* Description on the left, images on the right at half the card's
            width (spec 07). Without images the description takes it all. */}
        <Group align="flex-start" wrap="nowrap" gap="sm">
          <Box style={{ flex: '1 1 50%', minWidth: 0 }}>
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
          {hasImages && (
            <Box style={{ flex: '0 0 50%', minWidth: 0 }}>
              <DocumentCardImages images={document.images} documentName={document.name} />
            </Box>
          )}
        </Group>

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
