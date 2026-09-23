import { Card, Group, Stack, Title, Text } from '@mantine/core';
import { Link } from 'react-router-dom';
import { VisibilityBadge } from './VisibilityBadge';
import { TagList } from './TagList';
import { MentionText } from './mentions/MentionText';
import { displayNameFor } from '../lib/members';
import type { Document } from '../types/document';
import type { Member } from '../types/member';
import type { Tag } from '../types/tag';

interface DocumentCardProps {
  document: Document;
  roomId: string;
  tags: Tag[];
  members: Member[];
}

export function DocumentCard({ document, roomId, tags, members }: DocumentCardProps) {
  const ownerNames = document.ownerIds.map((id) => displayNameFor(members, id)).join(', ');

  return (
    <Card
      component={Link}
      to={`/rooms/${roomId}/documents/${document.id}`}
      withBorder
      padding="md"
      radius="md"
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
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
        {document.description && (
          // The card is itself a link, so mentions are only colored here.
          <MentionText text={document.description} linked={false} c="dimmed" size="sm" lineClamp={2} />
        )}
        <TagList tags={tags} tagIds={document.tagIds} />
        {ownerNames && (
          <Text size="xs" c="dimmed" truncate>
            Owner: {ownerNames}
          </Text>
        )}
      </Stack>
    </Card>
  );
}
