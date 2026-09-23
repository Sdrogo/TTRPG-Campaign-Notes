import { Group, Text } from '@mantine/core';
import type { Tag } from '../types/tag';

interface TagListProps {
  tags: Tag[];
  tagIds: string[];
}

/** The Tags among `tagIds`, shown as `#Name`. Renders nothing when there are none. */
export function TagList({ tags, tagIds }: TagListProps) {
  const selected = tags.filter((tag) => tagIds.includes(tag.id));

  if (selected.length === 0) {
    return null;
  }

  return (
    <Group gap={6}>
      {selected.map((tag) => (
        <Text key={tag.id} size="xs" c="dimmed">
          #{tag.name}
        </Text>
      ))}
    </Group>
  );
}
