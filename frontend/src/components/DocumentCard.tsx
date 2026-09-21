import { Card, Group, Stack, Title, Text } from '@mantine/core';
import { Link } from 'react-router-dom';
import { VisibilityBadge } from './VisibilityBadge';
import type { Document } from '../types/document';
import type { Tag } from '../types/tag';

interface DocumentCardProps {
  document: Document;
  roomId: string;
  tags: Tag[];
}

export function DocumentCard({ document, roomId, tags }: DocumentCardProps) {
  const documentTags = tags.filter((tag) => document.tagIds.includes(tag.id));

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
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Title order={4} style={{ fontFamily: 'var(--font-display)' }}>
            {document.name}
          </Title>
          <VisibilityBadge visibility={document.visibility} />
        </Group>
        {document.description && (
          <Text c="dimmed" size="sm" lineClamp={2}>
            {document.description}
          </Text>
        )}
        {documentTags.length > 0 && (
          <Group gap={6}>
            {documentTags.map((tag) => (
              <Text key={tag.id} size="xs" c="dimmed">
                #{tag.name}
              </Text>
            ))}
          </Group>
        )}
      </Stack>
    </Card>
  );
}
