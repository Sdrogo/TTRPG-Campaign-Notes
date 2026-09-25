import { Anchor, Drawer, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useTags } from '../hooks/useTags';
import { documentsWithTagsHref } from '../lib/documentMentions';
import { groupTagsByCategory, MAIN_TAG_CATEGORY } from '../lib/tags';

interface GlossaryIndexDrawerProps {
  roomId: string;
  opened: boolean;
  onClose: () => void;
}

/**
 * The Room's "Glossary Index" (spec `10 - UX Refinment`): a left-side
 * navigation drawer of every Tag, grouped by category (Main Tags first),
 * each one a shortcut to the Documents list filtered by it - the same
 * destination a `#Tag` mention leads to. Toggled from the burger menu in
 * `AppHeader`.
 */
export function GlossaryIndexDrawer({ roomId, opened, onClose }: GlossaryIndexDrawerProps) {
  const tags = useTags(roomId, opened);
  const groups = groupTagsByCategory(tags.data ?? []);

  return (
    <Drawer opened={opened} onClose={onClose} position="left" title="Indice dei Tag" size="xs">
      {groups.length === 0 ? (
        <Text c="dimmed" size="sm">
          Nessun Tag in questa Stanza.
        </Text>
      ) : (
        <Stack gap="md">
          {groups.map((group) => (
            <Stack key={group.category ?? 'none'} gap={4}>
              <Title order={6} c="dimmed" tt="uppercase">
                {group.category === MAIN_TAG_CATEGORY
                  ? 'Tag principali'
                  : (group.category ?? 'Altri Tag')}
              </Title>
              {group.tags.map((tag) => (
                <Anchor
                  key={tag.id}
                  component={Link}
                  to={documentsWithTagsHref(roomId, [tag.id])}
                  onClick={onClose}
                  size="sm"
                >
                  #{tag.name}
                </Anchor>
              ))}
            </Stack>
          ))}
        </Stack>
      )}
    </Drawer>
  );
}
