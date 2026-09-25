import { Box, Card, Group, Stack, Title, Text } from '@mantine/core';
import { Link } from 'react-router-dom';
import { VisibilityBadge } from './VisibilityBadge';
import { TagList } from './TagList';
import { DocumentCardImages } from './DocumentCardImages';
import { MentionText } from './mentions/MentionText';
import { displayNameFor } from '../lib/members';
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
 * images, with its Owners. The whole card links to the Document.
 */
export function DocumentCard({ document, roomId, tags, members }: DocumentCardProps) {
  const { t } = useTranslation();
  const ownerNames = document.ownerIds.map((id) => displayNameFor(members, id)).join(', ');
  const hasImages = document.images.length > 0;

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
            <VisibilityBadge visibility={document.visibility} />
          </Group>
          <TagList tags={tags} tagIds={document.tagIds} />
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
