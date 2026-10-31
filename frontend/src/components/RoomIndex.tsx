import { useState } from 'react';
import { Anchor, Box, Divider, Drawer, Loader, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { CaretRightIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useRoomSections } from '../hooks/useLanding';
import { blockAnchor, landingHref, sectionHref } from '../lib/landing';
import { sectionTitle } from '../lib/landingText';
import { useBackState } from '../lib/backNav';

/** What the page on screen adds to the Index (spec 55 Decision 10). */
export interface RoomIndexContext {
  /** The Section on screen: its id, or a page card's kind on the page it opens. */
  current?: string;
  /** Inside a custom Section: its title and its blocks, each with its sub-sections. */
  detail?: { title: string; entries: { id: string; label: string; children: string[] }[] };
}

interface RoomIndexProps extends RoomIndexContext {
  roomId: string;
}

/** The card's width; on a phone it never takes more than 85% of the screen.
 *  `.room-index-tab[data-opened]` in `index.css` sits at the same offset. */
const CARD_WIDTH = 'min(260px, 85vw)';

/**
 * The Room's Index (spec 44, reshaped by spec 55 Decision 10): a tab fixed on
 * the left edge of the Room's pages (`.room-index-tab` in `index.css`) that
 * slides out a card as tall as the screen, the tab riding on its right side
 * while open so a second click closes it. On top, the Room's global
 * navigation: "Home della Stanza" (the landing), then every Section card of
 * the landing in its order, the one on screen marked. Inside a custom
 * Section, set apart by a divider, what is on screen: each block (scrolling
 * to it) with its groups or features. Picking an entry closes the card.
 * Nothing is fetched before it first opens.
 */
export function RoomIndex({ roomId, current, detail }: RoomIndexProps) {
  const { t } = useTranslation();
  const backState = useBackState();
  const [opened, setOpened] = useState(false);
  const close = () => setOpened(false);
  const sections = useRoomSections(roomId, opened);
  const scrollTo = (blockId: string) => {
    close();
    document.getElementById(blockAnchor(blockId))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <UnstyledButton
        className="room-index-tab"
        data-tour="room-index"
        aria-label={opened ? t('glossary.closeToggle') : t('glossary.openToggle')}
        aria-expanded={opened}
        data-opened={opened || undefined}
        onClick={() => setOpened((now) => !now)}
      >
        <CaretRightIcon size={20} className="room-index-tab-arrow" />
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
          <Anchor component={Link} to={landingHref(roomId)} state={backState} onClick={close} size="sm" fw={600}>
            {t('roomLanding.home')}
          </Anchor>
          <Stack gap={4}>
            <Title order={6} c="dimmed" tt="uppercase">
              {t('roomLanding.sections')}
            </Title>
            {sections.isPending ? (
              <Loader size="xs" />
            ) : (
              (sections.data ?? []).map((section) => {
                const here = section.id === current || section.kind === current;
                return (
                  <Anchor
                    key={section.id}
                    component={Link}
                    to={sectionHref(roomId, section)}
                    state={backState}
                    onClick={close}
                    size="sm"
                    fw={here ? 700 : undefined}
                    c={here ? undefined : 'inherit'}
                    aria-current={here ? 'page' : undefined}
                  >
                    {sectionTitle(section)}
                  </Anchor>
                );
              })
            )}
          </Stack>
          {detail && detail.entries.length > 0 && (
            <>
              <Divider />
              <Stack gap={6}>
                <Title order={6} c="dimmed" tt="uppercase">
                  {detail.title}
                </Title>
                {detail.entries.map((entry) => (
                  <Stack key={entry.id} gap={0}>
                    <Anchor component="button" type="button" ta="left" size="sm" onClick={() => scrollTo(entry.id)}>
                      {entry.label}
                    </Anchor>
                    {entry.children.map((child) => (
                      <Text key={child} size="xs" c="dimmed" pl="sm">
                        {child}
                      </Text>
                    ))}
                  </Stack>
                ))}
              </Stack>
            </>
          )}
        </Stack>
      </Drawer>
    </>
  );
}
