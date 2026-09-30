import { Anchor, Drawer, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useMainItems } from '../hooks/useMainItems';
import { useTags } from '../hooks/useTags';
import { documentsWithTagsHref } from '../lib/documentMentions';
import { itemKey, itemLabel } from '../lib/mainItems';
import { groupTagsByCategory } from '../lib/tags';

interface GlossaryIndexDrawerProps {
  roomId: string;
  opened: boolean;
  onClose: () => void;
}

/**
 * The Room's "Glossary Index" (specs `10 - UX Refinment`, `11_3`): a left-side
 * navigation drawer. It opens with the Room's Main items - single Tags and
 * Tag combinations - in the same order the Documents page groups by (both
 * read `useMainItems`), then lists the other Tags by category. Each entry is a
 * shortcut to the Documents list filtered by its Tag or Tags (all of them, for
 * a combination) - the same destination a `#Tag` mention leads to. Toggled
 * from the burger menu in `AppHeader`.
 */
export function GlossaryIndexDrawer({ roomId, opened, onClose }: GlossaryIndexDrawerProps) {
  const tags = useTags(roomId, opened);
  const mainItems = useMainItems(roomId, opened);
  const groups = groupTagsByCategory(tags.data ?? [], mainItems.data ?? []);

  return (
    <Drawer opened={opened} onClose={onClose} position="left" title="Indice dei Tag" size="xs">
      {groups.length === 0 ? (
        <Text c="dimmed" size="sm">
          Nessun Tag in questa Stanza.
        </Text>
      ) : (
        <Stack gap="md">
          {groups.map((group) => (
            <Stack key={group.isMain ? 'main' : (group.category ?? 'none')} gap={4}>
              <Title order={6} c="dimmed" tt="uppercase">
                {group.isMain ? 'Tag principali' : (group.category ?? 'Altri Tag')}
              </Title>
              {group.entries.map((entry) => (
                <Anchor
                  key={itemKey(entry)}
                  component={Link}
                  to={documentsWithTagsHref(
                    roomId,
                    entry.map((tag) => tag.id),
                  )}
                  onClick={onClose}
                  size="sm"
                >
                  {itemLabel(entry)}
                </Anchor>
              ))}
            </Stack>
          ))}
        </Stack>
      )}
    </Drawer>
  );
}
