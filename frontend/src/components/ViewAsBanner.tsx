import { useState } from 'react';
import { Button, Group, Text } from '@mantine/core';
import { DownloadSimpleIcon, EyeIcon } from '@phosphor-icons/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMembers } from '../hooks/useMembers';
import { displayNameFor } from '../lib/members';
import type { ViewAs } from '../hooks/useViewAs';
import { ExportRoomModal } from './ExportRoomModal';
import type { ExitViewAsState } from './ViewAsProvider';

/**
 * The bar under the top bar while the Master previews the Room as a member
 * (spec 22b Decision 1): who, that nothing can be changed, "Export" for the
 * Room as that member sees it (spec 23 Decision 4), and "Exit", back to the
 * Master's own view of the same page.
 */
export function ViewAsBanner({ viewAs }: { viewAs: ViewAs }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const members = useMembers(viewAs.roomId, true);
  const name = displayNameFor(members.data ?? [], viewAs.userId);
  const [exportOpened, setExportOpened] = useState(false);

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
      <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
        {/* The request carries `X-View-As`, so this exports the member's view (spec 23 Decision 4). */}
        <Button
          size="compact-sm"
          variant="outline"
          color="dark"
          leftSection={<DownloadSimpleIcon size={14} aria-hidden="true" />}
          onClick={() => setExportOpened(true)}
        >
          {t('export.action')}
        </Button>
        <Button size="compact-sm" variant="white" color="dark" onClick={exit}>
          {t('viewAs.exit')}
        </Button>
      </Group>
      <ExportRoomModal
        opened={exportOpened}
        onClose={() => setExportOpened(false)}
        roomId={viewAs.roomId}
      />
    </Group>
  );
}
