import { useState } from 'react';
import { Button, Group, Stack, TextInput, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useUpdateRoomSettings } from '../../hooks/useRooms';
import { notifyError, notifySuccess } from '../../lib/notify';

interface RoomNameSectionProps {
  roomId: string;
  name: string;
}

/**
 * Renames the Room (Administrators only). Saving is only possible while the
 * button is enabled: a browser doesn't submit a form whose submit button is
 * disabled, Enter included. The name is trimmed and can't be
 * empty, as when the Room is created; the backend enforces both.
 */
export function RoomNameSection({ roomId, name }: RoomNameSectionProps) {
  const { t } = useTranslation();
  const updateSettings = useUpdateRoomSettings(roomId);
  const [draft, setDraft] = useState(name);
  const trimmed = draft.trim();
  const canSave = trimmed.length > 0 && trimmed !== name && !updateSettings.isPending;

  const save = () =>
    updateSettings.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          setDraft(trimmed);
          notifySuccess(t('setup.roomName.saved'));
        },
        onError: notifyError,
      },
    );

  return (
    <Stack gap="sm">
      <Title order={2} fz="h3" style={{ fontFamily: 'var(--font-display)' }}>
        {t('setup.roomName.title')}
      </Title>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Group align="flex-end" gap="sm" wrap="nowrap">
          <TextInput
            label={t('setup.roomName.label')}
            value={draft}
            maxLength={200}
            onChange={(event) => setDraft(event.currentTarget.value)}
            style={{ flex: 1 }}
            maw={360}
          />
          <Button type="submit" disabled={!canSave} loading={updateSettings.isPending}>
            {t('common.save')}
          </Button>
        </Group>
      </form>
    </Stack>
  );
}
