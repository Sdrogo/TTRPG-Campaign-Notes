import { Anchor, Group, Text } from '@mantine/core';
import { Link } from 'react-router-dom';
import { documentsWithTagsHref } from '../lib/documentMentions';
import type { Tag } from '../types/tag';

interface TagListProps {
  tags: Tag[];
  tagIds: string[];
  /**
   * When given, each Tag becomes a link to the Documents list filtered by it
   * (spec 10's "quick navigation" for `DocumentCard`). Omitted elsewhere (e.g.
   * the Document detail page), where Tags are shown as plain labels.
   */
  roomId?: string;
}

/**
 * The Tags among `tagIds`, shown as `#Name` - clickable when `roomId` is
 * given. Renders nothing when there are none.
 */
export function TagList({ tags, tagIds, roomId }: TagListProps) {
  const selected = tags.filter((tag) => tagIds.includes(tag.id));

  if (selected.length === 0) {
    return null;
  }

  return (
    <Group gap={6}>
      {selected.map((tag) =>
        roomId ? (
          <Anchor
            key={tag.id}
            component={Link}
            to={documentsWithTagsHref(roomId, [tag.id])}
            size="xs"
            c="var(--accent-primary)"
            // A card that wraps its content in a full-overlay link (e.g.
            // DocumentCard) puts that link above static content by default
            // (see DocumentCardImages' carousel controls) - this brings the
            // Tag back on top so it's the one that receives the click.
            pos="relative"
            style={{ zIndex: 2 }}
          >
            #{tag.name}
          </Anchor>
        ) : (
          <Text key={tag.id} size="xs" c="dimmed">
            #{tag.name}
          </Text>
        ),
      )}
    </Group>
  );
}
