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
  /**
   * The description's Document mentions are links of their own, each with
   * its preview and open menu (spec 37 Decision 2): on the Documents page,
   * not in a mention's preview, so a preview never opens another.
   */
  mentionLinks?: boolean;
}

/**
 * A Document in the Room's list: name, visibility, Tags and description, with
 * its images leading in a wide cover frame, its player (for a Character) and
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
  mentionLinks = false,
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
      data-tour="document-card"
      data-has-images={hasImages ? true : undefined}
      withBorder
      padding={hasImages ? 0 : 'md'}
      radius="md"
      pos="relative"
      className="document-card"
    >
      {/* A wide cover preserves the image without squeezing the card's text
          into a narrow half-column. The badges stay readable over its corner. */}
      {hasImages && (
        <Box className="document-card-media" data-testid="card-image-frame">
          <DocumentCardImages
            images={document.images}
            documentName={document.name}
            fade="bottom"
          />
        </Box>
      )}
      {hasImages && (
        <Box className="document-card-media-marks">
          {marks}
        </Box>
      )}

      <Stack
        gap="xs"
        pos="relative"
        p={hasImages ? 'md' : undefined}
        className="document-card-content"
      >
        {/* Title block: name and visibility on top, Tags on their own line. */}
        <Stack gap={4}>
          <Group justify="space-between" align="flex-start" wrap="nowrap" preventGrowOverflow={false}>
            {/* Spec 28_0 S2: the name is one size up from the subtitle, which
                takes the look the name had before, so every card's name
                looks the same with or without one. */}
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Title
                order={headingOrder}
                fz="h3"
                style={{ fontFamily: 'var(--font-display)', overflowWrap: 'anywhere' }}
              >
                {document.name}
              </Title>
              {document.subtitle && (
                <Text
                  fz="h4"
                  style={{ fontFamily: 'var(--font-display)', overflowWrap: 'anywhere' }}
                >
                  {document.subtitle}
                </Text>
              )}
            </Stack>
            {!hasImages && marks}
          </Group>
          <TagList tags={tags} tagIds={document.tagIds} roomId={roomId} />
        </Stack>

        {/* The description grows so the Played by and Owner lines close the
            card at the bottom. */}
        <Box className="document-card-description">
          {document.description ? (
            // The card's link lies over it: mentions are only colored here,
            // or Document mentions sit above it as links of their own.
            <MentionText
              text={document.description}
              linked={mentionLinks ? 'documents' : false}
              c="dimmed"
              size="sm"
              lineClamp={hasImages ? 3 : 2}
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
