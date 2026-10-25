import { useEffect, useRef } from 'react';
import { Button, Group, SegmentedControl, Text } from '@mantine/core';
import { FlaskIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { matchPath, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DEMO_START_PATH, exitDemo } from '../../lib/demo/demoMode';
import { VIEW_AS_PARAM } from '../../lib/viewAs';
import { useViewAs } from '../../hooks/useViewAs';

// The sample Room's Players (`lib/demo/demoData.ts`): fixed, so the switch
// needs no request.
const DEMO_PLAYERS = [
  { id: 'd3e0c0de-0000-4000-8000-000000000002', name: 'Marco' },
  { id: 'd3e0c0de-0000-4000-8000-000000000003', name: 'Giulia' },
] as const;

const PREVIEW_PAGES = ['/rooms/:roomId/documents/*', '/rooms/:roomId/maps/*'];

/**
 * The bar under the top bar while the Demo is on (spec 45_2, Decision 13):
 * what this is, who the visitor sees the Room as (the Master, or a Player
 * through spec 22b's preview), and the ways out.
 */
export function DemoBanner() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const queryClient = useQueryClient();
  const viewAs = useViewAs();

  // The sample content follows the UI language (Italian or English): a
  // change of language reloads it.
  const shownLanguage = useRef(i18n.language);
  useEffect(() => {
    if (shownLanguage.current === i18n.language) return;
    shownLanguage.current = i18n.language;
    void queryClient.invalidateQueries();
  }, [i18n.language, queryClient]);

  // A full page load, like entering the Demo: the open page's queries are
  // bound to the cache they started in, so a switch in place would keep
  // showing what the previous viewer saw.
  const switchTo = (userId: string) => {
    const onRoomPage = PREVIEW_PAGES.some((pattern) => matchPath(pattern, location.pathname));
    const pathname = onRoomPage ? location.pathname : DEMO_START_PATH;
    window.location.assign(userId === 'master' ? pathname : `${pathname}?${VIEW_AS_PARAM}=${userId}`);
  };

  return (
    <Group className="demo-banner" role="status" justify="space-between" gap="xs" px="sm" py={6}>
      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
        <FlaskIcon size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
        <Text size="sm" fw={500}>
          {t('demo.banner')}
        </Text>
      </Group>
      <Group gap="xs">
        <Text size="sm" c="dimmed" component="span" id="demo-view-as">
          {t('demo.viewAs')}
        </Text>
        <SegmentedControl
          size="xs"
          aria-labelledby="demo-view-as"
          value={viewAs?.userId ?? 'master'}
          onChange={switchTo}
          data={[
            { value: 'master', label: t('roles.master') },
            ...DEMO_PLAYERS.map((player) => ({ value: player.id, label: player.name })),
          ]}
        />
        <Button size="compact-sm" variant="default" onClick={() => exitDemo('/')}>
          {t('demo.exit')}
        </Button>
        <Button size="compact-sm" onClick={() => exitDemo('/#sign-in')}>
          {t('landing.signIn')}
        </Button>
      </Group>
    </Group>
  );
}
