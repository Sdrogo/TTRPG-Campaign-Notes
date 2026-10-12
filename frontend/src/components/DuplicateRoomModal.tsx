import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useDuplicateRoom } from '../hooks/useRooms';
import { notifyError, notifySuccess } from '../lib/notify';

interface DuplicateRoomModalProps {
  opened: boolean;
  onClose: () => void;
  roomId: string;
  roomName: string;
}

/**
 * Confirms duplicating a Room (spec 33, the Master only): names the copy and
 * says what is and isn't copied. On success the new card appears in the list
 * (the Rooms query is refetched) and a toast names it; on failure the
 * backend's text is shown and the modal stays open.
 */
export function DuplicateRoomModal({ opened, onClose, roomId, roomName }: DuplicateRoomModalProps) {
  const { t } = useTranslation();
  const duplicateRoom = useDuplicateRoom(roomId);

  const handleDuplicate = () => {
    duplicateRoom.mutate(undefined, {
      onSuccess: (copy) => {
        notifySuccess(t('rooms.duplicate.created', { name: copy.room.name }));
        onClose();
      },
      onError: notifyError,
    });
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('rooms.duplicate.confirmTitle', { name: roomName })}
      centered
    >
      <Stack gap="md">
        <Text size="sm">{t('rooms.duplicate.confirmBody')}</Text>
        <Text size="sm" c="dimmed">
          {t('rooms.duplicate.copyName', { name: roomName })}
        </Text>
        <Group justify="flex-end">
          <Button variant="subtle" color="gray" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={duplicateRoom.isPending} onClick={handleDuplicate}>
            {t('rooms.duplicate.action')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
