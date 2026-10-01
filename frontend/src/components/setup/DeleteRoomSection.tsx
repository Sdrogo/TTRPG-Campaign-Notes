import { useState } from 'react';
import { Button, Group, Modal, Stack, Text, TextInput, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useDeleteRoom } from '../../hooks/useRooms';
import { notifyError, notifySuccess } from '../../lib/notify';

interface DeleteRoomSectionProps {
  roomId: string;
  roomName: string;
  /** Called once the Room is gone, to leave a page that no longer has anything to show. */
  onDeleted: () => void;
}

/**
 * The Room setup's danger zone (spec 13): permanently deletes the Room. It
 * follows the Document deletion workflow (red button, confirmation modal)
 * with one more step, since the blast radius is the whole Room: the red
 * button stays disabled until the Room's name is typed.
 */
export function DeleteRoomSection({ roomId, roomName, onDeleted }: DeleteRoomSectionProps) {
  const { t } = useTranslation();
  const deleteRoom = useDeleteRoom(roomId);
  const [opened, setOpened] = useState(false);
  const [typed, setTyped] = useState('');

  const close = () => {
    setOpened(false);
    setTyped('');
  };

  const handleDelete = () => {
    deleteRoom.mutate(undefined, {
      onSuccess: () => {
        notifySuccess(t('setup.dangerZone.deleted', { name: roomName }));
        onDeleted();
      },
      onError: notifyError,
    });
  };

  return (
    <Stack gap="sm">
      <Title order={3} style={{ fontFamily: 'var(--font-display)' }}>
        {t('setup.dangerZone.title')}
      </Title>
      <Text size="sm" c="dimmed">
        {t('setup.dangerZone.description')}
      </Text>
      <Group>
        <Button variant="outline" color="red" onClick={() => setOpened(true)}>
          {t('setup.dangerZone.deleteRoom')}
        </Button>
      </Group>

      <Modal
        opened={opened}
        onClose={close}
        title={t('setup.dangerZone.confirmTitle', { name: roomName })}
        centered
      >
        <Stack gap="md">
          <Text size="sm">{t('setup.dangerZone.confirmBody')}</Text>
          <TextInput
            label={t('setup.dangerZone.confirmLabel', { name: roomName })}
            value={typed}
            onChange={(event) => setTyped(event.currentTarget.value)}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button
              color="red"
              disabled={typed.trim() !== roomName}
              loading={deleteRoom.isPending}
              onClick={handleDelete}
            >
              {t('common.delete')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
