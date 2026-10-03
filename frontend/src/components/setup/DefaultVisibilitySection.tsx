import { Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { VisibilitySelect } from '../VisibilitySelect';
import { useUpdateRoomSettings } from '../../hooks/useRooms';
import { notifyError, notifySuccess } from '../../lib/notify';
import type { DocumentVisibility } from '../../types/document';

// Selective needs a list of people, so it can't be a default (spec 22 Decision 5).
const DEFAULT_LEVELS: DocumentVisibility[] = ['room', 'master', 'private'];

interface DefaultVisibilitySectionProps {
  roomId: string;
  value: DocumentVisibility;
}

/**
 * The Room's default visibility (VR-05, spec 22 Decision 5), chosen by the
 * Administrators: the level every new Document, Note and Comment starts at.
 * Saved as soon as it is picked; existing content doesn't change.
 */
export function DefaultVisibilitySection({ roomId, value }: DefaultVisibilitySectionProps) {
  const { t } = useTranslation();
  const updateSettings = useUpdateRoomSettings(roomId);

  return (
    <Stack gap="sm">
      <Title order={2} fz="h3" style={{ fontFamily: 'var(--font-display)' }}>
        {t('setup.defaultVisibility.title')}
      </Title>
      <Text size="sm" c="dimmed">
        {t('setup.defaultVisibility.description')}
      </Text>
      <VisibilitySelect
        subject="document"
        label={t('setup.defaultVisibility.label')}
        levels={DEFAULT_LEVELS}
        value={value}
        disabled={updateSettings.isPending}
        onChange={(defaultVisibility) =>
          updateSettings.mutate(
            { defaultVisibility },
            {
              onSuccess: () => notifySuccess(t('setup.defaultVisibility.saved')),
              onError: notifyError,
            },
          )
        }
        maw={360}
      />
    </Stack>
  );
}
