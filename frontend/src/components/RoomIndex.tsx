import { useState } from 'react';
import { Anchor, Box, Drawer, Loader, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { CaretRightIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMainItems } from '../hooks/useMainItems';
import { useMaps } from '../hooks/useMaps';
import { useTags } from '../hooks/useTags';
import { documentsWithTagsHref } from '../lib/documentMentions';
import { itemKey, itemLabel } from '../lib/mainItems';
import { groupTagsByCategory } from '../lib/tags';

interface RoomIndexProps {
  roomId: string;
}

/** The card's width; on a phone it never takes more than 85% of the screen.
 *  `.room-index-tab[data-opened]` in `index.css` sits at the same offset. */
const CARD_WIDTH = 'min(260px, 85vw)';

/**
 * The Room's Index (spec 44; specs `10 - UX Refinment`, `11_3` before it): a
 * tab fixed on the left edge of every Room page (`.room-index-tab` in
 * `index.css`) that slides out a card narrow in width and as tall as the
 * screen, the tab riding on its right side while open so a second click
 * closes it. The card lists the Room's sections: the Main items - single Tags
 * and Tag combinations - in the same order the Documents page groups by (both
 * read `useMainItems`), then the other Tags by category, each a shortcut to
 * the Documents list filtered by its Tag or Tags (the same destination a
 * `#Tag` mention leads to); last the maps, after a link to the Maps page.
 * Picking an entry closes the card. Nothing is fetched before it first opens.
 */
export function RoomIndex({ roomId }: RoomIndexProps) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  const close = () => setOpened(false);
  const tags = useTags(roomId, opened);
  const mainItems = useMainItems(roomId, opened);
  const maps = useMaps(roomId, opened);
  const groups = groupTagsByCategory(tags.data ?? [], mainItems.data ?? []);
  // "No Tags" only once the Tags are known to be none: not while they load,
  // and not when they failed (the Maps section still works then).
  const tagsLoading = tags.isPending || mainItems.isPending;
  const sortedMaps = [...(maps.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <UnstyledButton
        className="room-index-tab"
        data-tour="room-index"
        aria-label={opened ? t('glossary.closeToggle') : t('glossary.openToggle')}
        aria-expanded={opened}
        data-opened={opened || undefined}
        onClick={() => setOpened((current) => !current)}
      >
        <CaretRightIcon size={18} className="room-index-tab-arrow" />
        <Box component="span" className="room-index-tab-label" visibleFrom="sm">
          {t('glossary.tab')}
        </Box>
      </UnstyledButton>
      <Drawer
        opened={opened}
        onClose={close}
        position="left"
        size={CARD_WIDTH}
        title={t('glossary.title')}
        overlayProps={{ backgroundOpacity: 0.3 }}
        styles={{ title: { fontFamily: 'var(--font-display)', fontSize: 'var(--mantine-font-size-lg)' } }}
      >
        <Stack gap="md">
          {tagsLoading ? (
            <Loader size="xs" />
          ) : tags.isError ? null : groups.length === 0 ? (
            <Text c="dimmed" size="sm">
              {t('glossary.empty')}
            </Text>
          ) : (
            groups.map((group) => (
              <Stack key={group.isMain ? 'main' : (group.category ?? 'none')} gap={4}>
                <Title order={6} c="dimmed" tt="uppercase">
                  {group.isMain ? t('glossary.mainTags') : (group.category ?? t('glossary.otherTags'))}
                </Title>
                {group.entries.map((entry) => (
                  <Anchor
                    key={itemKey(entry)}
                    component={Link}
                    to={documentsWithTagsHref(
                      roomId,
                      entry.map((tag) => tag.id),
                    )}
                    onClick={close}
                    size="sm"
                  >
                    {itemLabel(entry)}
                  </Anchor>
                ))}
              </Stack>
            ))
          )}
          <Stack gap={4}>
            <Title order={6} c="dimmed" tt="uppercase">
              {t('maps.title')}
            </Title>
            <Anchor component={Link} to={`/rooms/${roomId}/maps`} onClick={close} size="sm" fw={600}>
              {t('glossary.allMaps')}
            </Anchor>
            {sortedMaps.map((map) => (
              <Anchor
                key={map.id}
                component={Link}
                to={`/rooms/${roomId}/maps/${map.id}`}
                onClick={close}
                size="sm"
              >
                {map.name}
              </Anchor>
            ))}
          </Stack>
        </Stack>
      </Drawer>
    </>
  );
}
