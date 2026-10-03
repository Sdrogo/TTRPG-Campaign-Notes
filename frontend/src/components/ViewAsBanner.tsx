import { Button, Group, Text } from '@mantine/core';
import { EyeIcon } from '@phosphor-icons/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMembers } from '../hooks/useMembers';
import { displayNameFor } from '../lib/members';
import type { ViewAs } from '../hooks/useViewAs';
import type { ExitViewAsState } from './ViewAsProvider';

/**
 * The bar under the top bar while the Master previews the Room as a member
 * (spec 22b Decision 1): who, that nothing can be changed, and "Exit", back
 * to the Master's own view of the same page.
 */
export function ViewAsBanner({ viewAs }: { viewAs: ViewAs }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const members = useMembers(viewAs.roomId, true);
  const name = displayNameFor(members.data ?? [], viewAs.userId);

  const exit = () => {
    const state: ExitViewAsState = { exitViewAs: true };
    void navigate({ pathname: location.pathname, hash: location.hash }, { state });
  };

  return (
    <Group
      className="view-as-banner"
      role="status"
      justify="space-between"
      wrap="nowrap"
      gap="sm"
      px="sm"
      py={6}
    >
      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
        <EyeIcon size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
        <Text size="sm" fw={500} truncate>
          {t('viewAs.banner', { name })}
        </Text>
      </Group>
      <Button size="compact-sm" variant="white" color="dark" onClick={exit}>
        {t('viewAs.exit')}
      </Button>
    </Group>
  );
}
